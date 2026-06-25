const { Op, fn, col, literal } = require('sequelize');
const { Worker, EmploymentDetail, Document, ValidationResult, WageMaster, Payroll, Site } = require('../models');
const { COMPLIANCE_WEIGHTS, RISK_DEDUCTIONS } = require('../config/constants');

/**
 * Calculate compliance score for a company (0–100).
 * Formula: weighted average of 5 sub-scores.
 */
async function getComplianceScore(companyId, siteId = null) {
  const where = { company_id: companyId, status: 'active' };
  if (siteId) where.site_id = siteId;

  const total = await Worker.count({ where });
  if (total === 0) return { score: 100, breakdown: {}, total: 0 };

  // 1. Documents verified
  const verifiedDocWorkers = await Worker.count({
    where,
    include: [{
      model: Document,
      as: 'documents',
      where: { doc_type: 'aadhaar', status: 'verified' },
      required: true,
    }],
  });

  // 2. Wage compliant (join with wage_master)
  const wageNonCompliant = await Worker.count({
    where,
    include: [{
      model: EmploymentDetail,
      as: 'employment',
      required: true,
    }],
  });
  // Simplified: count workers where wage >= master rate
  const wageCompliantCount = await countWageCompliant(companyId, siteId);

  // 3. Age compliant (validated age check passed)
  const ageCompliant = await ValidationResult.count({
    where: { check_name: 'age_verification', result: 'pass' },
    include: [{ model: Worker, as: 'worker', where, attributes: [] }],
  });

  // 4. UAN present
  const uanPresent = await Worker.count({
    where,
    include: [{ model: EmploymentDetail, as: 'employment', where: { uan_encrypted: { [Op.ne]: null } }, required: true }],
  });

  // 5. ESIC compliant (applicable + has number, or not applicable)
  const esicApplicable = await Worker.count({
    where,
    include: [{ model: EmploymentDetail, as: 'employment', where: { esic_applicable: true }, required: true }],
  });
  const esicCompliantCount = await Worker.count({
    where,
    include: [{
      model: EmploymentDetail,
      as: 'employment',
      where: { esic_applicable: true, esic_encrypted: { [Op.ne]: null } },
      required: true,
    }],
  });
  const esicScore = esicApplicable > 0 ? esicCompliantCount / esicApplicable : 1;

  const breakdown = {
    documents_verified: verifiedDocWorkers / total,
    wage_compliant: total > 0 ? wageCompliantCount / total : 1,
    age_compliant: ageCompliant / total,
    uan_present: uanPresent / total,
    esic_compliant: esicScore,
  };

  const score = Object.entries(COMPLIANCE_WEIGHTS).reduce((sum, [key, weight]) => {
    return sum + (breakdown[key] || 0) * weight * 100;
  }, 0);

  return { score: Math.round(score), breakdown, total };
}

async function countWageCompliant(companyId, siteId) {
  // Get all active workers with employment details
  const workers = await Worker.findAll({
    where: { company_id: companyId, status: 'active', ...(siteId ? { site_id: siteId } : {}) },
    include: [{ model: EmploymentDetail, as: 'employment', required: true }],
  });

  let compliant = 0;
  for (const w of workers) {
    const emp = w.employment;
    const wm = await WageMaster.findOne({
      where: { company_id: companyId, category: emp.category, zone: emp.zone },
      order: [['effective_from', 'DESC']],
    });
    if (!wm || parseFloat(emp.wage_rate) >= parseFloat(wm.wage_rate)) compliant++;
  }
  return compliant;
}

/**
 * Site risk indicator = 100 - compliance_score - flag_deductions.
 * Returns 0–100 where 100 = highest risk (inverted for display).
 */
async function getSiteRiskIndicator(companyId, siteId) {
  const { score } = await getComplianceScore(companyId, siteId);
  const where = { company_id: companyId, status: 'active', site_id: siteId };

  const [missingDocs, failedValidations, wageIssues] = await Promise.all([
    Document.count({ where: { status: 'pending' }, include: [{ model: Worker, as: 'worker', where, attributes: [] }] }),
    ValidationResult.count({ where: { result: 'fail' }, include: [{ model: Worker, as: 'worker', where, attributes: [] }] }),
    ValidationResult.count({ where: { result: 'fail', check_name: 'wage_compliance' }, include: [{ model: Worker, as: 'worker', where, attributes: [] }] }),
  ]);

  const deductions =
    missingDocs * RISK_DEDUCTIONS.missing_doc +
    failedValidations * RISK_DEDUCTIONS.failed_validation +
    wageIssues * RISK_DEDUCTIONS.wage_below_minimum;

  const riskScore = Math.max(0, Math.min(100, 100 - score - deductions));
  return { riskScore, deductions, missingDocs, failedValidations, wageIssues };
}

/**
 * Export-ready salary register for a company/month.
 */
async function getSalaryRegister(companyId, month, year, siteId = null) {
  const workerWhere = { company_id: companyId, status: 'active' };
  if (siteId) workerWhere.site_id = siteId;

  const payrolls = await Payroll.findAll({
    where: { month, year },
    include: [{ model: Worker, as: 'worker', where: workerWhere, include: [{ model: EmploymentDetail, as: 'employment' }, { model: Site, as: 'site' }] }],
    order: [[{ model: Worker, as: 'worker' }, 'name', 'ASC']],
  });

  return payrolls.map(p => ({
    worker_id: p.worker_id,
    name: p.worker.name,
    site: p.worker.site ? p.worker.site.name : '',
    category: p.worker.employment ? p.worker.employment.category : '',
    days_present: p.days_present,
    ot_hours: p.ot_hours,
    gross: p.gross,
    pf_deduction: p.pf_deduction,
    esic_deduction: p.esic_deduction,
    net_pay: p.net_pay,
  }));
}

module.exports = { getComplianceScore, getSiteRiskIndicator, getSalaryRegister };
