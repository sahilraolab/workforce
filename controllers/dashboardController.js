const { Op, fn, col, literal } = require('sequelize');
const { Worker, Attendance, ValidationResult, Document, Subscription, Site, AuditLog, User } = require('../models');
const { scopeWhere } = require('../middlewares/tenantScope');
const { todayLocal } = require('../utils/dateUtil');

exports.index = async (req, res) => {
  try {
    const workerWhere = scopeWhere(req, {});
    const companyId = req.tenantScope.company_id;

    const today = todayLocal();

    const [
      totalWorkers,
      activeWorkers,
      pendingDocs,
      failedValidations,
      subscription,
      todayPresent,
    ] = await Promise.all([
      Worker.count({ where: workerWhere }),
      Worker.count({ where: { ...workerWhere, status: 'active' } }),
      Document.count({ where: { status: 'pending' }, include: [{ model: Worker, as: 'worker', where: workerWhere, attributes: [] }] }),
      ValidationResult.count({ where: { result: 'fail' }, include: [{ model: Worker, as: 'worker', where: workerWhere, attributes: [] }] }),
      companyId ? Subscription.findOne({ where: { company_id: companyId } }) : null,
      Attendance.count({
        where: { date: today, status: 'present' },
        include: [{ model: Worker, as: 'worker', where: workerWhere, attributes: [] }],
      }),
    ]);

    // Compliance by site — top 5 active sites with worker counts + pending docs
    let siteCompliance = [];
    try {
      const siteWhere = companyId ? { company_id: companyId, status: 'active' } : { status: 'active' };
      const sites = await Site.findAll({ where: siteWhere, limit: 5 });
      siteCompliance = await Promise.all(sites.map(async (site) => {
        const [siteWorkers, sitePending] = await Promise.all([
          Worker.count({ where: { ...workerWhere, site_id: site.id, status: 'active' } }),
          Document.count({
            where: { status: 'pending' },
            include: [{ model: Worker, as: 'worker', where: { ...workerWhere, site_id: site.id }, attributes: [] }],
          }),
        ]);
        const score = siteWorkers > 0 ? Math.round(((siteWorkers - sitePending) / siteWorkers) * 100) : 100;
        return { name: site.name, workers: siteWorkers, pending: sitePending, score };
      }));
      // Sort descending by score
      siteCompliance.sort((a, b) => b.score - a.score);
    } catch (_) { /* non-critical */ }

    // Recent activity — last 6 audit log entries, tenant-scoped
    let recentActivity = [];
    try {
      const auditWhere = companyId ? { company_id: companyId } : {};
      recentActivity = await AuditLog.findAll({
        where: auditWhere,
        include: [{ model: User, as: 'user', attributes: ['name'], required: false }],
        order: [['created_at', 'DESC']],
        limit: 6,
      });
    } catch (_) { /* non-critical */ }

    res.render('dashboard/index', {
      title: 'Dashboard',
      stats: { totalWorkers, activeWorkers, pendingDocs, failedValidations, todayPresent },
      subscription,
      siteCompliance,
      recentActivity,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    req.flash('error', res.locals.t('err_load_dashboard'));
    res.render('dashboard/index', {
      title: 'Dashboard',
      stats: {},
      subscription: null,
      siteCompliance: [],
      recentActivity: [],
    });
  }
};
