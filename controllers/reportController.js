const { Op, fn, col, QueryTypes } = require('sequelize');
const { sequelize } = require('../models');
const { Worker, EmploymentDetail, Document, ValidationResult, Site, AuditLog, WageMaster, Payroll, ComplianceFiling } = require('../models');
const { scopeWhere } = require('../middlewares/tenantScope');
const { getComplianceScore, getSiteRiskIndicator } = require('../services/reportService');
const { logAudit } = require('../middlewares/auditLogger');
const { Parser } = require('json2csv');
const { paginate, buildPageData } = require('../utils/pagination');

exports.compliance = async (req, res) => {
  try {
    const siteId = req.query.site_id || null;
    const companyId = req.tenantScope.company_id;

    const { score, breakdown, total } = await getComplianceScore(companyId, siteId);

    // Labour count by site
    const workerWhere = scopeWhere(req, {}, { allowSiteFilter: false });
    const labourBySite = await Worker.findAll({
      where: workerWhere,
      attributes: ['site_id', [fn('COUNT', col('Worker.id')), 'count'], [fn('SUM', col('Worker.status')), 'active_count']],
      include: [{ model: Site, as: 'site', attributes: ['name'] }],
      group: ['Worker.site_id', 'site.id'],
      raw: false,
    });

    // Missing documents
    const { page, limit, offset } = paginate(req.query);
    const workerScope = scopeWhere(req, {});
    if (siteId) workerScope.site_id = siteId;
    const { count: missingCount, rows: missingDocWorkers } = await Worker.findAndCountAll({
      where: { ...workerScope, status: 'active' },
      include: [{
        model: Document,
        as: 'documents',
        where: { doc_type: { [Op.in]: ['aadhaar', 'passport_photo', 'bank_passbook'] }, status: { [Op.ne]: 'verified' } },
        required: true,
      }],
      distinct: true,
      limit,
      offset,
    });

    // Skill category breakdown
    const categoryBreakdown = await sequelize.query(
      `SELECT ed.category, COUNT(w.id) AS count
       FROM workers w
       LEFT JOIN employment_details ed ON w.id = ed.worker_id
       WHERE w.company_id = :companyId
       ${ siteId ? 'AND w.site_id = :siteId' : '' }
       GROUP BY ed.category`,
      { replacements: { companyId, siteId }, type: QueryTypes.SELECT }
    );

    const sites = await Site.findAll({ where: scopeWhere(req, {}, { allowSiteFilter: false }), attributes: ['id', 'name'] });

    res.render('reports/compliance', {
      title: 'Compliance Dashboard',
      score,
      breakdown,
      total,
      labourBySite,
      missingDocWorkers,
      categoryBreakdown,
      sites,
      selectedSite: siteId,
      pageData: buildPageData(missingCount, page, limit),
      query: req.query,
    });
  } catch (err) {
    console.error(err);
    req.flash('error', res.locals.t('err_load_compliance'));
    res.redirect('/dashboard');
  }
};

exports.wageReport = async (req, res) => {
  const companyId = req.tenantScope.company_id;
  const { page, limit, offset } = paginate(req.query);

  // Get workers with wage below minimum
  const workers = await Worker.findAll({
    where: scopeWhere(req, { status: 'active' }),
    include: [
      { model: EmploymentDetail, as: 'employment', required: true },
      { model: Site, as: 'site', attributes: ['name'] },
    ],
  });

  const belowMinimum = [];
  for (const w of workers) {
    const emp = w.employment;
    const wm = await WageMaster.findOne({
      where: { company_id: companyId, category: emp.category, zone: emp.zone },
      order: [['effective_from', 'DESC']],
    });
    if (wm && parseFloat(emp.wage_rate) < parseFloat(wm.wage_rate)) {
      belowMinimum.push({ worker: w, emp, minimum: wm.wage_rate });
    }
  }

  if (req.query.export === 'csv') {
    const data = belowMinimum.map(r => ({
      name: r.worker.name,
      site: r.worker.site ? r.worker.site.name : '',
      category: r.emp.category,
      zone: r.emp.zone,
      current_wage: r.emp.wage_rate,
      minimum_wage: r.minimum,
      shortfall: (parseFloat(r.minimum) - parseFloat(r.emp.wage_rate)).toFixed(2),
    }));
    const parser = new Parser({ fields: Object.keys(data[0] || {}) });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="wage-report.csv"');
    return res.send(parser.parse(data));
  }

  res.render('reports/wage', {
    title: 'Wage Compliance Report',
    belowMinimum: belowMinimum.slice(offset, offset + limit),
    pageData: buildPageData(belowMinimum.length, page, limit),
    query: req.query,
  });
};

exports.pfReport = async (req, res) => {
  const workerWhere = scopeWhere(req, { status: 'active' });
  const { page, limit, offset } = paginate(req.query);

  const total = await Worker.count({ where: workerWhere });
  const withUan = await Worker.count({
    where: workerWhere,
    include: [{ model: EmploymentDetail, as: 'employment', where: { uan_encrypted: { [Op.ne]: null } }, required: true }],
  });

  const { count, rows: workers } = await Worker.findAndCountAll({
    where: workerWhere,
    include: [
      { model: EmploymentDetail, as: 'employment', attributes: ['uan_last4', 'uan_encrypted', 'category'] },
      { model: Site, as: 'site', attributes: ['name'] },
    ],
    order: [['name', 'ASC']],
    limit,
    offset,
    distinct: true,
  });

  res.render('reports/pf', {
    title: 'PF Compliance Report',
    total,
    withUan,
    percentage: total > 0 ? Math.round((withUan / total) * 100) : 0,
    workers,
    pageData: buildPageData(count, page, limit),
    query: req.query,
  });
};

// PF/ESIC are calculated per payroll run but that's not proof of compliance —
// an inspector wants to know whether the amount was actually deposited with
// EPFO/ESIC. This computes the trailing 12 periods' deduction totals from
// Payroll and pairs each with any ComplianceFiling row recording the actual
// filing (challan number + filed date), defaulting to "pending" if none exists.
exports.filingsReport = async (req, res) => {
  const companyId = req.tenantScope.company_id;
  const workerWhere = scopeWhere(req, {});

  const periods = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    periods.push({ month: d.getMonth() + 1, year: d.getFullYear() });
  }

  const rows = [];
  for (const { month, year } of periods) {
    const totals = await Payroll.findOne({
      where: { month, year },
      include: [{ model: Worker, as: 'worker', where: workerWhere, attributes: [] }],
      attributes: [
        [fn('SUM', col('pf_deduction')), 'pf_total'],
        [fn('SUM', col('esic_deduction')), 'esic_total'],
      ],
      raw: true,
    });
    const amounts = { pf: parseFloat(totals?.pf_total || 0), esic: parseFloat(totals?.esic_total || 0) };

    for (const type of ['pf', 'esic']) {
      const filing = await ComplianceFiling.findOne({
        where: { company_id: companyId, filing_type: type, period_month: month, period_year: year },
      });
      rows.push({
        month, year, type,
        amount: amounts[type],
        status: filing ? filing.status : 'pending',
        challan_no: filing ? filing.challan_no : null,
        filed_date: filing ? filing.filed_date : null,
      });
    }
  }

  if (req.query.export === 'csv') {
    const data = rows.map(r => ({
      period: `${r.month}/${r.year}`,
      type: r.type.toUpperCase(),
      amount: r.amount.toFixed(2),
      status: r.status,
      challan_no: r.challan_no || '',
      filed_date: r.filed_date || '',
    }));
    const parser = new Parser({ fields: Object.keys(data[0] || {}) });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="pf-esic-filings.csv"');
    return res.send(parser.parse(data));
  }

  res.render('reports/filings', { title: 'PF/ESIC Filing Tracker', rows });
};

exports.markFiled = async (req, res) => {
  try {
    const companyId = req.tenantScope.company_id;
    const { type, month, year } = req.params;
    const { challan_no, filed_date } = req.body;

    if (!['pf', 'esic'].includes(type)) {
      req.flash('error', res.locals.t('err_invalid_filing_type'));
      return res.redirect('/reports/filings');
    }

    let filing = await ComplianceFiling.findOne({
      where: { company_id: companyId, filing_type: type, period_month: month, period_year: year },
    });
    const before = filing ? { status: filing.status } : null;

    if (filing) {
      await filing.update({ status: 'filed', challan_no, filed_date, filed_by: req.session.user.id });
    } else {
      filing = await ComplianceFiling.create({
        company_id: companyId, filing_type: type, period_month: month, period_year: year,
        status: 'filed', challan_no, filed_date, filed_by: req.session.user.id,
      });
    }

    await logAudit(req, { action: 'update', entity: 'ComplianceFiling', entity_id: filing.id, before_value: before, after_value: { status: 'filed', challan_no } });
    req.flash('success', res.locals.t('ok_filing_marked'));
    res.redirect('/reports/filings');
  } catch (err) {
    console.error('Mark filed error:', err);
    req.flash('error', res.locals.t('err_mark_filed'));
    res.redirect('/reports/filings');
  }
};

exports.auditReport = async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const where = {};
  if (req.tenantScope.company_id) where.company_id = req.tenantScope.company_id;
  if (req.query.entity) where.entity = req.query.entity;
  if (req.query.action) where.action = req.query.action;
  if (req.query.from && req.query.to) {
    where.created_at = { [Op.between]: [new Date(req.query.from), new Date(req.query.to + 'T23:59:59')] };
  }

  const { count, rows: logs } = await AuditLog.findAndCountAll({
    where,
    include: [{ model: require('../models').User, as: 'user', attributes: ['name', 'email', 'role'] }],
    order: [['created_at', 'DESC']],
    limit,
    offset,
  });

  if (req.query.export === 'csv') {
    const data = logs.map(l => ({
      timestamp: l.created_at,
      user: l.user ? l.user.name : '',
      action: l.action,
      entity: l.entity,
      entity_id: l.entity_id,
      ip: l.ip_address,
    }));
    const parser = new Parser({ fields: Object.keys(data[0] || {}) });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
    return res.send(parser.parse(data));
  }

  res.render('reports/audit', {
    title: 'Audit Log',
    logs,
    pageData: buildPageData(count, page, limit),
    query: req.query,
  });
};
