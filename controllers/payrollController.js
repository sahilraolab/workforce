const { Payroll, Worker, EmploymentDetail, Site } = require('../models');
const { generateMonthlyPayroll } = require('../services/payrollService');
const { getSalaryRegister } = require('../services/reportService');
const { scopeWhere } = require('../middlewares/tenantScope');
const { logAudit } = require('../middlewares/auditLogger');
const { Parser } = require('json2csv');

exports.index = async (req, res) => {
  const month = parseInt(req.query.month || new Date().getMonth() + 1, 10);
  const year = parseInt(req.query.year || new Date().getFullYear(), 10);
  const siteId = req.query.site_id || null;

  try {
    const workerWhere = scopeWhere(req, { status: 'active' });
    if (siteId) workerWhere.site_id = siteId;

    const payrolls = await Payroll.findAll({
      where: { month, year },
      include: [{
        model: Worker,
        as: 'worker',
        where: workerWhere,
        include: [
          { model: EmploymentDetail, as: 'employment', attributes: ['category', 'zone'] },
          { model: Site, as: 'site', attributes: ['name'] },
        ],
      }],
      order: [[{ model: Worker, as: 'worker' }, 'name', 'ASC']],
    });

    const sites = await Site.findAll({ where: scopeWhere(req, {}, { allowSiteFilter: false }), attributes: ['id', 'name'] });

    // Totals
    const totals = payrolls.reduce((acc, p) => {
      acc.gross += parseFloat(p.gross) || 0;
      acc.pf += parseFloat(p.pf_deduction) || 0;
      acc.esic += parseFloat(p.esic_deduction) || 0;
      acc.net += parseFloat(p.net_pay) || 0;
      return acc;
    }, { gross: 0, pf: 0, esic: 0, net: 0 });

    if (req.query.export === 'csv') {
      const data = await getSalaryRegister(req.tenantScope.company_id, month, year, siteId);
      const parser = new Parser({ fields: Object.keys(data[0] || {}) });
      const csv = parser.parse(data);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="salary-register-${year}-${month}.csv"`);
      return res.send(csv);
    }

    res.render('payroll/index', {
      title: `Payroll — ${month}/${year}`,
      payrolls,
      month,
      year,
      sites,
      selectedSite: siteId,
      totals,
      generated: payrolls.length > 0,
    });
  } catch (err) {
    console.error(err);
    req.flash('error', res.locals.t('err_load_payroll'));
    res.redirect('/dashboard');
  }
};

exports.generate = async (req, res) => {
  const { month, year, site_id } = req.body;
  try {
    const results = await generateMonthlyPayroll({
      companyId: req.tenantScope.company_id,
      siteId: site_id || null,
      month: parseInt(month, 10),
      year: parseInt(year, 10),
      generatedBy: req.session.user.id,
    });

    await logAudit(req, {
      action: 'create', entity: 'Payroll',
      after_value: { month, year, workers: results.length },
    });

    req.flash('success', res.locals.t('ok_payroll_generated', { count: results.length }));
    res.redirect(`/payroll?month=${month}&year=${year}`);
  } catch (err) {
    console.error(err);
    req.flash('error', res.locals.t('err_generate_payroll'));
    res.redirect('/payroll');
  }
};
