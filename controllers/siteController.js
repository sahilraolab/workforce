const { validationResult } = require('express-validator');
const { Site, User, Worker } = require('../models');
const { scopeWhere, assertTenantOwnership } = require('../middlewares/tenantScope');
const { logAudit } = require('../middlewares/auditLogger');
const { paginate, buildPageData } = require('../utils/pagination');
const { ROLES } = require('../config/constants');

exports.list = async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req.query);
    const where = scopeWhere(req, {}, { allowSiteFilter: false });
    if (req.query.status) where.status = req.query.status;

    const { count, rows: sites } = await Site.findAndCountAll({
      where,
      include: [{ model: User, as: 'supervisor', attributes: ['id', 'name', 'email'] }],
      order: [['name', 'ASC']],
      limit,
      offset,
    });

    const workerCounts = await Worker.findAll({
      attributes: ['site_id', [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'count']],
      where: { company_id: req.tenantScope.company_id, status: 'active' },
      group: ['site_id'],
      raw: true,
    });
    const wMap = {};
    workerCounts.forEach(r => { wMap[r.site_id] = parseInt(r.count, 10); });

    res.render('sites/list', {
      title: 'Sites',
      sites,
      wMap,
      pageData: buildPageData(count, page, limit),
      query: req.query,
    });
  } catch (err) {
    console.error(err);
    req.flash('error', res.locals.t('err_load_sites'));
    res.redirect('/dashboard');
  }
};

exports.showCreate = async (req, res) => {
  const users = await User.findAll({ where: scopeWhere(req, { status: 'active' }, { allowSiteFilter: false }), attributes: ['id', 'name', 'email'] });
  res.render('sites/form', { title: 'New Site', site: null, users, errors: [] });
};

exports.create = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const users = await User.findAll({ where: scopeWhere(req, {}, { allowSiteFilter: false }), attributes: ['id', 'name', 'email'] });
    return res.render('sites/form', { title: 'New Site', site: req.body, users, errors: errors.array() });
  }

  const { name, location, supervisor_user_id } = req.body;
  try {
    const site = await Site.create({
      company_id: req.tenantScope.company_id,
      name,
      location,
      supervisor_user_id: supervisor_user_id || null,
      created_by: req.session.user.id,
    });

    // Assign site to supervisor user
    if (supervisor_user_id) {
      await User.update({ site_id: site.id }, { where: { id: supervisor_user_id } });
    }

    await logAudit(req, { action: 'create', entity: 'Site', entity_id: site.id, after_value: { name, location } });
    req.flash('success', res.locals.t('ok_site_created', { name }));
    res.redirect('/sites');
  } catch (err) {
    console.error(err);
    req.flash('error', res.locals.t('err_create_site'));
    res.redirect('/sites/new');
  }
};

exports.showEdit = async (req, res) => {
  try {
    const site = await Site.findByPk(req.params.id);
    if (!site) { req.flash('error', res.locals.t('err_site_not_found')); return res.redirect('/sites'); }
    assertTenantOwnership(site, req);
    const users = await User.findAll({ where: scopeWhere(req, {}, { allowSiteFilter: false }), attributes: ['id', 'name', 'email'] });
    res.render('sites/form', { title: 'Edit Site', site, users, errors: [] });
  } catch (err) {
    if (err.status === 403) { req.flash('error', res.locals.t('err_access_denied')); return res.redirect('/sites'); }
    req.flash('error', res.locals.t('err_server')); res.redirect('/sites');
  }
};

exports.update = async (req, res) => {
  try {
    const site = await Site.findByPk(req.params.id);
    if (!site) { req.flash('error', res.locals.t('err_site_not_found')); return res.redirect('/sites'); }
    assertTenantOwnership(site, req);

    const before = site.toJSON();
    const { name, location, supervisor_user_id, status } = req.body;

    // Reassign supervisor if changed
    if (site.supervisor_user_id && site.supervisor_user_id !== parseInt(supervisor_user_id)) {
      await User.update({ site_id: null }, { where: { id: site.supervisor_user_id } });
    }
    if (supervisor_user_id) {
      await User.update({ site_id: site.id }, { where: { id: supervisor_user_id } });
    }

    await site.update({ name, location, supervisor_user_id: supervisor_user_id || null, status, updated_by: req.session.user.id });
    await logAudit(req, { action: 'update', entity: 'Site', entity_id: site.id, before_value: before, after_value: req.body });
    req.flash('success', res.locals.t('ok_site_updated'));
    res.redirect('/sites');
  } catch (err) {
    console.error(err);
    req.flash('error', res.locals.t('err_update_site'));
    res.redirect(`/sites/${req.params.id}/edit`);
  }
};
