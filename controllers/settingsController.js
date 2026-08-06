const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { User, WageMaster, Site, Company } = require('../models');
const { scopeWhere } = require('../middlewares/tenantScope');
const { logAudit } = require('../middlewares/auditLogger');
const { WORKER_CATEGORIES, ZONES, ROLES } = require('../config/constants');

// Used for both initial user creation and admin-initiated resets — a random
// 8-character password instead of a static default, so every account starts
// with a real, unguessable secret rather than everyone sharing "Temp@1234".
function generateSecurePassword() {
  return crypto.randomBytes(6).toString('base64url') + 'A1!';
}

exports.profile = (req, res) => {
  res.render('settings/profile', { title: 'My Profile', errors: [] });
};

// Handles two independent forms on the same page (Profile Information and
// Change Password) — each submits only its own fields, so this only acts on
// whichever fields were actually present rather than requiring both at once.
exports.updateProfile = async (req, res) => {
  const { name, current_password, new_password, new_password_confirm } = req.body;
  const t = res.locals.t;
  try {
    const user = await User.findByPk(req.session.user.id);
    const updates = { updated_by: req.session.user.id };

    if (name) {
      updates.name = name.trim();
    }

    if (new_password) {
      if (new_password.length < 8) {
        req.flash('error', t('err_password_min'));
        return res.redirect('/settings/profile');
      }
      if (new_password_confirm !== undefined && new_password !== new_password_confirm) {
        req.flash('error', t('val_password_mismatch'));
        return res.redirect('/settings/profile');
      }
      const valid = await bcrypt.compare(current_password || '', user.password_hash);
      if (!valid) {
        req.flash('error', t('err_current_password_wrong'));
        return res.redirect('/settings/profile');
      }
      updates.password_hash = await bcrypt.hash(new_password, 12);
    }

    await user.update(updates);
    if (updates.name) req.session.user.name = updates.name;

    req.flash('success', new_password ? t('ok_password_changed') : t('ok_profile_updated'));
    res.redirect('/settings/profile');
  } catch (err) {
    console.error(err);
    req.flash('error', t('err_update_profile'));
    res.redirect('/settings/profile');
  }
};

exports.users = async (req, res) => {
  const isSuperAdmin = req.tenantScope.role === ROLES.SUPER_ADMIN;
  const where = scopeWhere(req, {}, { allowSiteFilter: false });
  // Super admin manages users across every tenant — let them narrow to one
  // company, since the flat list is otherwise hard to navigate.
  if (isSuperAdmin && req.query.company_id) where.company_id = req.query.company_id;

  const users = await User.findAll({
    where,
    include: [
      { model: Site, as: 'site', attributes: ['name'] },
      ...(isSuperAdmin ? [{ model: Company, as: 'company', attributes: ['id', 'name'] }] : []),
    ],
    order: [['name', 'ASC']],
  });
  const sites = await Site.findAll({ where: scopeWhere(req, {}, { allowSiteFilter: false }), attributes: ['id', 'name'] });
  const companies = isSuperAdmin ? await Company.findAll({ attributes: ['id', 'name'], order: [['name', 'ASC']] }) : [];
  res.render('settings/users', { title: 'Manage Users', users, sites, companies, isSuperAdmin, selectedCompanyId: req.query.company_id || '' });
};

exports.createUser = async (req, res) => {
  const { name, email, role, site_id, company_id } = req.body;
  try {
    // Super admin has no company of their own — they must pick which
    // tenant this user belongs to (the form only shows this field to them).
    const targetCompanyId = req.tenantScope.role === ROLES.SUPER_ADMIN ? company_id : req.tenantScope.company_id;
    if (!targetCompanyId) {
      req.flash('error', res.locals.t('val_company_name_required'));
      return res.redirect('/settings/users');
    }
    const tempPassword = generateSecurePassword();
    const hash = await bcrypt.hash(tempPassword, 12);
    const user = await User.create({
      company_id: targetCompanyId,
      site_id: site_id || null,
      name, email: email.toLowerCase().trim(),
      password_hash: hash,
      role, status: 'active',
      created_by: req.session.user.id,
    });
    await logAudit(req, { action: 'create', entity: 'User', entity_id: user.id, after_value: { name, email, role } });
    req.flash('generatedPasswordFor', name);
    req.flash('generatedPassword', tempPassword);
    res.redirect('/settings/users');
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      req.flash('error', res.locals.t('err_email_in_use'));
    } else {
      req.flash('error', res.locals.t('err_create_user'));
    }
    res.redirect('/settings/users');
  }
};

// Admin-initiated password reset — the only way a user's password gets reset,
// since there is no self-service "forgot password" flow. Generates a random
// temporary password and shows it to the admin once; it is never emailed or
// logged anywhere.
exports.resetUserPassword = async (req, res) => {
  try {
    const user = await User.findOne({
      where: scopeWhere(req, { id: req.params.id }, { allowSiteFilter: false }),
    });
    if (!user) {
      req.flash('error', res.locals.t('err_user_not_found'));
      return res.redirect('/settings/users');
    }

    const tempPassword = generateSecurePassword();
    const hash = await bcrypt.hash(tempPassword, 12);
    await user.update({ password_hash: hash, updated_by: req.session.user.id });

    await logAudit(req, { action: 'update', entity: 'User', entity_id: user.id, after_value: { password_reset: true } });
    req.flash('generatedPasswordFor', user.name);
    req.flash('generatedPassword', tempPassword);
    res.redirect('/settings/users');
  } catch (err) {
    console.error('Reset user password error:', err);
    req.flash('error', res.locals.t('err_reset_password'));
    res.redirect('/settings/users');
  }
};

// Toggle a user between active/inactive. Inactive users are blocked at login
// (see authController.login) but their data/history is preserved — this is
// the "deactivate" equivalent of the worker deactivate flow, just for users.
exports.toggleUserStatus = async (req, res) => {
  try {
    const user = await User.findOne({
      where: scopeWhere(req, { id: req.params.id }, { allowSiteFilter: false }),
    });
    if (!user) {
      req.flash('error', res.locals.t('err_user_not_found'));
      return res.redirect('/settings/users');
    }
    if (user.id === req.session.user.id) {
      req.flash('error', res.locals.t('err_cannot_change_own_status'));
      return res.redirect('/settings/users');
    }

    const newStatus = user.status === 'active' ? 'inactive' : 'active';
    const before = { status: user.status };
    await user.update({ status: newStatus, updated_by: req.session.user.id });

    await logAudit(req, { action: 'update', entity: 'User', entity_id: user.id, before_value: before, after_value: { status: newStatus } });
    req.flash('success', res.locals.t(newStatus === 'active' ? 'ok_user_activated' : 'ok_user_deactivated', { name: user.name }));
    res.redirect('/settings/users');
  } catch (err) {
    console.error('Toggle user status error:', err);
    req.flash('error', res.locals.t('err_toggle_user_status'));
    res.redirect('/settings/users');
  }
};

exports.wageMaster = async (req, res) => {
  if (!req.tenantScope.company_id) {
    req.flash('error', 'Wage master is managed per company. Select a company first.');
    return res.redirect('/companies');
  }
  const wages = await WageMaster.findAll({
    where: { company_id: req.tenantScope.company_id },
    order: [['category', 'ASC'], ['zone', 'ASC'], ['effective_from', 'DESC']],
  });
  const existingZones = [...new Set(wages.map(w => w.zone))].sort();
  res.render('settings/wage-master', { title: 'Wage Master', wages, categories: WORKER_CATEGORIES, zones: existingZones });
};

function normalizeZone(raw) {
  return (raw || '').trim().replace(/\s+/g, '_').toLowerCase();
}

exports.createWage = async (req, res) => {
  if (!req.tenantScope.company_id) {
    req.flash('error', 'Wage master is managed per company. Select a company first.');
    return res.redirect('/companies');
  }
  const { category, wage_rate, effective_from } = req.body;
  const zone = normalizeZone(req.body.zone);
  if (!zone) {
    req.flash('error', 'Zone name is required.');
    return res.redirect('/settings/wage-master');
  }
  try {
    await WageMaster.create({
      company_id: req.tenantScope.company_id,
      category, zone,
      wage_rate: parseFloat(wage_rate),
      effective_from,
      created_by: req.session.user.id,
    });
    await logAudit(req, { action: 'create', entity: 'WageMaster', after_value: { category, zone, wage_rate, effective_from } });
    req.flash('success', res.locals.t('ok_wage_added'));
    res.redirect('/settings/wage-master');
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      req.flash('error', `A wage rate for "${category}" in zone "${zone}" already exists.`);
    } else {
      console.error(err);
      req.flash('error', res.locals.t('err_save_wage'));
    }
    res.redirect('/settings/wage-master');
  }
};

exports.companySettings = async (req, res) => {
  try {
    const company = await Company.findByPk(req.tenantScope.company_id);
    if (!company) { req.flash('error', 'Company not found.'); return res.redirect('/settings/profile'); }
    res.render('settings/company-settings', {
      title: 'Company Settings',
      company,
    });
  } catch (err) {
    console.error(err);
    req.flash('error', res.locals.t('err_server'));
    res.redirect('/settings/profile');
  }
};

exports.updateCompanySettings = async (req, res) => {
  try {
    const company = await Company.findByPk(req.tenantScope.company_id);
    if (!company) { req.flash('error', 'Company not found.'); return res.redirect('/settings/company'); }
    const before = { regulatory_regime: company.regulatory_regime, jurisdiction: company.jurisdiction, address: company.address };
    const { regulatory_regime, jurisdiction, address, contact_email, contact_phone } = req.body;
    await company.update({
      regulatory_regime: regulatory_regime || company.regulatory_regime,
      jurisdiction: jurisdiction || company.jurisdiction,
      address: address || company.address,
      contact_email: contact_email || company.contact_email,
      contact_phone: contact_phone || company.contact_phone,
      updated_by: req.session.user.id,
    });
    await logAudit(req, { action: 'update', entity: 'Company', entity_id: company.id, before_value: before, after_value: { regulatory_regime, jurisdiction, address } });
    req.flash('success', 'Company settings saved.');
    res.redirect('/settings/company');
  } catch (err) {
    console.error(err);
    req.flash('error', res.locals.t('err_server'));
    res.redirect('/settings/company');
  }
};
