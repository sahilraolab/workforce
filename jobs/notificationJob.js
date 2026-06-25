const cron = require('node-cron');
const { Op } = require('sequelize');
const { Company, User, Document, Worker, EmploymentDetail, Subscription, NotificationLog, CompanyLicense } = require('../models');
const { sendEmail } = require('../utils/emailService');
const { LICENSE_EXPIRY_ALERT_DAYS } = require('../config/constants');

// Run daily at 8:00 AM
cron.schedule('0 8 * * *', async () => {
  console.log('[cron] Running daily notification job...');
  try {
    await checkPendingDocuments();
    await checkMissingUanEsic();
    await checkWageNonCompliance();
    await checkExpiringSubscriptions();
    await checkExpiringLicenses();
    console.log('[cron] Notification job complete.');
  } catch (err) {
    console.error('[cron] Notification job error:', err.message);
  }
});

async function notify({ company_id, type, message, recipient }) {
  const log = await NotificationLog.create({
    company_id,
    type,
    message,
    recipient,
    status: 'pending',
  });
  try {
    await sendEmail({
      to: recipient,
      subject: `[WorkforceSaaS] ${type}`,
      text: message,
      html: `<p>${message}</p>`,
    });
    await log.update({ status: 'sent', sent_at: new Date() });
  } catch (err) {
    await log.update({ status: 'failed', error_message: err.message });
  }
}

async function checkPendingDocuments() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);

  const oldPendingDocs = await Document.findAll({
    where: { status: 'pending', created_at: { [Op.lt]: cutoff } },
    include: [{ model: Worker, as: 'worker', attributes: ['company_id', 'name'] }],
  });

  if (oldPendingDocs.length === 0) return;

  // Group by company
  const byCompany = {};
  oldPendingDocs.forEach(d => {
    const cid = d.worker.company_id;
    if (!byCompany[cid]) byCompany[cid] = [];
    byCompany[cid].push(`${d.worker.name} (${d.doc_type})`);
  });

  for (const [companyId, docs] of Object.entries(byCompany)) {
    const admins = await User.findAll({ where: { company_id: companyId, role: 'company_admin', status: 'active' } });
    for (const admin of admins) {
      await notify({
        company_id: companyId,
        type: 'Pending Documents Alert',
        message: `${docs.length} document(s) have been pending review for more than 7 days:\n${docs.join(', ')}`,
        recipient: admin.email,
      });
    }
  }
}

async function checkMissingUanEsic() {
  const workers = await Worker.findAll({
    where: { status: 'active' },
    include: [{ model: EmploymentDetail, as: 'employment', where: { esic_applicable: true, esic_encrypted: null }, required: false }],
  });

  const missingEsic = workers.filter(w => w.employment && w.employment.esic_applicable && !w.employment.esic_encrypted);

  const byCompany = {};
  missingEsic.forEach(w => {
    if (!byCompany[w.company_id]) byCompany[w.company_id] = [];
    byCompany[w.company_id].push(w.name);
  });

  for (const [companyId, names] of Object.entries(byCompany)) {
    const hrs = await User.findAll({ where: { company_id: companyId, role: { [Op.in]: ['hr_payroll', 'company_admin'] }, status: 'active' } });
    for (const hr of hrs) {
      await notify({
        company_id: companyId,
        type: 'Missing ESIC/UAN Alert',
        message: `${names.length} worker(s) are ESIC applicable but have no ESIC number: ${names.join(', ')}`,
        recipient: hr.email,
      });
    }
  }
}

async function checkWageNonCompliance() {
  const { WageMaster } = require('../models');
  const workers = await Worker.findAll({
    where: { status: 'active' },
    include: [{ model: EmploymentDetail, as: 'employment', required: true }],
  });

  const byCompany = {};
  for (const w of workers) {
    const emp = w.employment;
    const wm = await WageMaster.findOne({
      where: { company_id: w.company_id, category: emp.category, zone: emp.zone },
      order: [['effective_from', 'DESC']],
    });
    if (wm && parseFloat(emp.wage_rate) < parseFloat(wm.wage_rate)) {
      if (!byCompany[w.company_id]) byCompany[w.company_id] = [];
      byCompany[w.company_id].push(`${w.name} (₹${emp.wage_rate} < ₹${wm.wage_rate})`);
    }
  }

  for (const [companyId, list] of Object.entries(byCompany)) {
    const admins = await User.findAll({ where: { company_id: companyId, role: 'company_admin', status: 'active' } });
    for (const admin of admins) {
      await notify({
        company_id: companyId,
        type: 'Wage Compliance Alert',
        message: `${list.length} worker(s) are paid below the minimum wage: ${list.join('; ')}`,
        recipient: admin.email,
      });
    }
  }
}

async function checkExpiringSubscriptions() {
  const { sequelize } = require('../models');
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() + 7);
  const today = new Date().toISOString().split('T')[0];
  const cutoff = cutoffDate.toISOString().split('T')[0];

  const expiring = await Subscription.findAll({
    where: {
      status: 'active',
      end_date: { [Op.between]: [today, cutoff] },
    },
    include: [{ model: Company, as: 'company' }],
  });

  for (const sub of expiring) {
    const admins = await User.findAll({ where: { company_id: sub.company_id, role: { [Op.in]: ['company_admin'] }, status: 'active' } });
    const superAdmins = await User.findAll({ where: { role: 'super_admin', status: 'active' } });
    const recipients = [...admins, ...superAdmins];

    const daysLeft = Math.ceil((new Date(sub.end_date) - new Date()) / (1000 * 60 * 60 * 24));

    for (const u of recipients) {
      await notify({
        company_id: sub.company_id,
        type: 'Subscription Expiring',
        message: `Subscription for ${sub.company.name} expires in ${daysLeft} day(s) (${sub.end_date}). Plan: ${sub.plan}.`,
        recipient: u.email,
      });
    }
  }
}

// Licenses need lead time to renew (unlike a 7-day subscription-expiry
// warning), so this alerts on a longer window.
async function checkExpiringLicenses() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() + LICENSE_EXPIRY_ALERT_DAYS);
  const today = new Date().toISOString().split('T')[0];
  const cutoff = cutoffDate.toISOString().split('T')[0];

  const expiring = await CompanyLicense.findAll({
    where: { expiry_date: { [Op.between]: [today, cutoff] } },
  });

  if (expiring.length === 0) return;

  const byCompany = {};
  expiring.forEach(lic => {
    if (!byCompany[lic.company_id]) byCompany[lic.company_id] = [];
    const daysLeft = Math.ceil((new Date(lic.expiry_date) - new Date()) / (1000 * 60 * 60 * 24));
    byCompany[lic.company_id].push(`${lic.license_type} #${lic.license_number} (${daysLeft} day(s), expires ${lic.expiry_date})`);
  });

  for (const [companyId, list] of Object.entries(byCompany)) {
    const admins = await User.findAll({ where: { company_id: companyId, role: 'company_admin', status: 'active' } });
    for (const admin of admins) {
      await notify({
        company_id: companyId,
        type: 'License Expiring',
        message: `${list.length} license(s)/registration(s) are expiring soon: ${list.join('; ')}`,
        recipient: admin.email,
      });
    }
  }
}

module.exports = {};
