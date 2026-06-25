const { CompanyLicense, Company } = require('../models');
const { assertTenantOwnership } = require('../middlewares/tenantScope');
const { logAudit } = require('../middlewares/auditLogger');
const { ROLES, LICENSE_TYPES } = require('../config/constants');
const { Parser } = require('json2csv');

async function fetchLicenses(req) {
  const isSuperAdmin = req.tenantScope.role === ROLES.SUPER_ADMIN;
  const where = isSuperAdmin && req.query.company_id
    ? { company_id: req.query.company_id }
    : (isSuperAdmin ? {} : { company_id: req.tenantScope.company_id });
  const licenses = await CompanyLicense.findAll({
    where,
    include: isSuperAdmin ? [{ model: Company, as: 'company', attributes: ['id', 'name'] }] : [],
    order: [['expiry_date', 'ASC']],
  });
  return { isSuperAdmin, licenses };
}

exports.list = async (req, res) => {
  const { isSuperAdmin, licenses } = await fetchLicenses(req);

  /* ── CSV export ── */
  if (req.query.export === 'csv') {
    const fields = [
      { label: 'License Type',       value: 'license_type' },
      { label: 'License Number',     value: 'license_number' },
      { label: 'Issuing Authority',  value: 'issuing_authority' },
      { label: 'Issue Date',         value: 'issue_date' },
      { label: 'Expiry Date',        value: 'expiry_date' },
      { label: 'Notes',              value: 'notes' },
      ...(isSuperAdmin ? [{ label: 'Company', value: (r) => r.company ? r.company.name : '' }] : []),
    ];
    const csv = new Parser({ fields }).parse(licenses.map(l => l.toJSON()));
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="license-register.csv"');
    return res.send(csv);
  }

  const companies = isSuperAdmin ? await Company.findAll({ attributes: ['id', 'name'], order: [['name', 'ASC']] }) : [];
  res.render('settings/licenses', {
    title: 'Licenses & Registrations',
    licenses,
    companies,
    isSuperAdmin,
    selectedCompanyId: req.query.company_id || '',
    licenseTypes: Object.values(LICENSE_TYPES),
  });
};

exports.create = async (req, res) => {
  const { license_type, license_number, issuing_authority, issue_date, expiry_date, notes, company_id } = req.body;
  try {
    const targetCompanyId = req.tenantScope.role === ROLES.SUPER_ADMIN ? company_id : req.tenantScope.company_id;
    if (!targetCompanyId) {
      req.flash('error', res.locals.t('val_company_name_required'));
      return res.redirect('/settings/licenses');
    }
    const license = await CompanyLicense.create({
      company_id: targetCompanyId,
      license_type, license_number,
      issuing_authority: issuing_authority || null,
      issue_date: issue_date || null,
      expiry_date,
      notes: notes || null,
      created_by: req.session.user.id,
    });
    await logAudit(req, { action: 'create', entity: 'CompanyLicense', entity_id: license.id, after_value: { license_type, license_number, expiry_date } });
    req.flash('success', res.locals.t('ok_license_created'));
    res.redirect('/settings/licenses');
  } catch (err) {
    console.error('Create license error:', err);
    req.flash('error', res.locals.t('err_create_license'));
    res.redirect('/settings/licenses');
  }
};

// Renewal is just an update — same form fields, new expiry/issue date and
// optionally a new license number if the authority reissued it.
exports.update = async (req, res) => {
  const { license_type, license_number, issuing_authority, issue_date, expiry_date, notes } = req.body;
  try {
    const license = await CompanyLicense.findByPk(req.params.id);
    if (!license) {
      req.flash('error', res.locals.t('err_license_not_found'));
      return res.redirect('/settings/licenses');
    }
    assertTenantOwnership(license, req);

    const before = { license_number: license.license_number, expiry_date: license.expiry_date };
    await license.update({
      license_type, license_number,
      issuing_authority: issuing_authority || null,
      issue_date: issue_date || null,
      expiry_date,
      notes: notes || null,
      updated_by: req.session.user.id,
    });
    await logAudit(req, { action: 'update', entity: 'CompanyLicense', entity_id: license.id, before_value: before, after_value: { license_number, expiry_date } });
    req.flash('success', res.locals.t('ok_license_renewed'));
    res.redirect('/settings/licenses');
  } catch (err) {
    if (err.status === 403) { req.flash('error', res.locals.t('err_access_denied')); return res.redirect('/settings/licenses'); }
    console.error('Update license error:', err);
    req.flash('error', res.locals.t('err_update_license'));
    res.redirect('/settings/licenses');
  }
};

exports.remove = async (req, res) => {
  try {
    const license = await CompanyLicense.findByPk(req.params.id);
    if (!license) {
      req.flash('error', res.locals.t('err_license_not_found'));
      return res.redirect('/settings/licenses');
    }
    assertTenantOwnership(license, req);

    await license.destroy();
    await logAudit(req, { action: 'delete', entity: 'CompanyLicense', entity_id: license.id });
    req.flash('success', res.locals.t('ok_license_deleted'));
    res.redirect('/settings/licenses');
  } catch (err) {
    if (err.status === 403) { req.flash('error', res.locals.t('err_access_denied')); return res.redirect('/settings/licenses'); }
    console.error('Delete license error:', err);
    req.flash('error', res.locals.t('err_delete_license'));
    res.redirect('/settings/licenses');
  }
};
