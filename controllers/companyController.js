const bcrypt = require('bcrypt');
const { validationResult } = require('express-validator');
const { Company, User, Site, Subscription, Worker } = require('../models');
const { logAudit } = require('../middlewares/auditLogger');
const { paginate, buildPageData } = require('../utils/pagination');
const { SUBSCRIPTION_PLANS } = require('../config/constants');

// Plan key -> default worker limit (null = unlimited), keyed by the lowercase
// DB enum value so it can be looked up directly from req.body.plan.
const PLAN_WORKER_LIMITS = Object.values(SUBSCRIPTION_PLANS).reduce((acc, p) => {
  acc[p.name.toLowerCase()] = p.worker_limit;
  return acc;
}, {});

exports.list = async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req.query);
    const search = req.query.search || '';
    const where = search ? { name: { [require('sequelize').Op.like]: `%${search}%` } } : {};

    const { count, rows: companies } = await Company.findAndCountAll({
      where,
      include: [{ model: Subscription, as: 'subscription' }],
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    // Worker counts per company
    const workerCounts = await Worker.findAll({
      attributes: ['company_id', [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'count']],
      group: ['company_id'],
      raw: true,
    });
    const countMap = {};
    workerCounts.forEach(r => { countMap[r.company_id] = parseInt(r.count, 10); });

    res.render('companies/list', {
      title: 'Companies',
      companies,
      countMap,
      pageData: buildPageData(count, page, limit),
      query: req.query,
      search,
    });
  } catch (err) {
    console.error(err);
    req.flash('error', res.locals.t('err_load_companies'));
    res.redirect('/dashboard');
  }
};

// `formValues` is always a flat plain object with exactly the fields the
// form displays — never a raw Sequelize instance or req.body directly.
// This keeps the template from having to guess "is this create or edit"
// from object shape, which previously caused the form to render
// action="/admin/companies/undefined?_method=PUT" on a failed create.
function emptyFormValues() {
  return { name: '', plan: 'starter', contact_email: '', contact_phone: '', worker_limit: '', end_date: '', status: 'active' };
}

function formValuesFromCompany(company) {
  return {
    name: company.name,
    plan: company.plan,
    contact_email: company.contact_email || '',
    contact_phone: company.contact_phone || '',
    worker_limit: company.subscription ? (company.subscription.worker_limit ?? '') : '',
    end_date: company.subscription ? company.subscription.end_date : '',
    status: company.status,
  };
}

exports.showCreate = (req, res) => {
  res.render('companies/form', {
    title: 'New Company', companyId: null, values: emptyFormValues(), errors: [], planLimits: PLAN_WORKER_LIMITS,
  });
};

exports.create = async (req, res) => {
  const t = res.locals.t;
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('companies/form', {
      title: 'New Company', companyId: null, values: { ...emptyFormValues(), ...req.body }, errors: errors.array(), planLimits: PLAN_WORKER_LIMITS,
    });
  }

  const { name, address, contact_email, contact_phone, plan, worker_limit, end_date, admin_name, admin_email, admin_password } = req.body;

  const dbT = await require('../config/db').transaction();
  try {
    const company = await Company.create({
      name, address, contact_email, contact_phone,
      plan: plan || 'starter',
      status: 'active',
      created_by: req.session.user.id,
    }, { transaction: dbT });

    // Use the request's worker_limit if given, otherwise fall back to the
    // plan's default (e.g. Growth -> 500) rather than a hardcoded number.
    const effectiveLimit = worker_limit ? parseInt(worker_limit, 10) : PLAN_WORKER_LIMITS[plan || 'starter'];

    await Subscription.create({
      company_id: company.id,
      plan: plan || 'starter',
      status: 'active',
      worker_limit: effectiveLimit,
      start_date: new Date(),
      end_date,
      created_by: req.session.user.id,
    }, { transaction: dbT });

    // Create Company Admin user
    const hash = await bcrypt.hash(admin_password, 12);
    await User.create({
      company_id: company.id,
      name: admin_name,
      email: admin_email.toLowerCase().trim(),
      password_hash: hash,
      role: 'company_admin',
      status: 'active',
      created_by: req.session.user.id,
    }, { transaction: dbT });

    await dbT.commit();

    await logAudit(req, { action: 'create', entity: 'Company', entity_id: company.id, after_value: { name } });
    req.flash('success', t('ok_company_created', { name }));
    res.redirect('/admin/companies');
  } catch (err) {
    await dbT.rollback();
    // This must render inline (not flash+redirect) — a flash set on this
    // same request wouldn't be readable until the *next* request, so the
    // user would see a blank form with no error and assume nothing happened.
    let message;
    if (err.name === 'SequelizeUniqueConstraintError') {
      message = t('err_admin_email_in_use');
    } else {
      console.error(err);
      message = t('err_create_company');
    }
    res.render('companies/form', {
      title: 'New Company', companyId: null, values: { ...emptyFormValues(), ...req.body }, errors: [{ msg: message }], planLimits: PLAN_WORKER_LIMITS,
    });
  }
};

exports.showEdit = async (req, res) => {
  try {
    const company = await Company.findByPk(req.params.id, { include: [{ model: Subscription, as: 'subscription' }] });
    if (!company) { req.flash('error', res.locals.t('err_company_not_found')); return res.redirect('/admin/companies'); }
    res.render('companies/form', {
      title: 'Edit Company', companyId: company.id, values: formValuesFromCompany(company), errors: [], planLimits: PLAN_WORKER_LIMITS,
    });
  } catch (err) {
    req.flash('error', res.locals.t('err_server')); res.redirect('/admin/companies');
  }
};

exports.update = async (req, res) => {
  const t = res.locals.t;
  try {
    const company = await Company.findByPk(req.params.id, { include: [{ model: Subscription, as: 'subscription' }] });
    if (!company) { req.flash('error', t('err_company_not_found')); return res.redirect('/admin/companies'); }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render('companies/form', {
        title: 'Edit Company', companyId: company.id, values: { ...formValuesFromCompany(company), ...req.body }, errors: errors.array(), planLimits: PLAN_WORKER_LIMITS,
      });
    }

    const before = company.toJSON();
    const { name, address, contact_email, contact_phone, status, plan, worker_limit, end_date } = req.body;

    await company.update({ name, address, contact_email, contact_phone, status, plan, updated_by: req.session.user.id });

    if (company.subscription) {
      const effectiveLimit = worker_limit ? parseInt(worker_limit, 10) : PLAN_WORKER_LIMITS[plan];
      await company.subscription.update({ plan, worker_limit: effectiveLimit, end_date, updated_by: req.session.user.id });
    }

    await logAudit(req, { action: 'update', entity: 'Company', entity_id: company.id, before_value: before, after_value: req.body });
    req.flash('success', t('ok_company_updated'));
    res.redirect('/admin/companies');
  } catch (err) {
    console.error(err);
    req.flash('error', t('err_update_company'));
    res.redirect(`/admin/companies/${req.params.id}/edit`);
  }
};
