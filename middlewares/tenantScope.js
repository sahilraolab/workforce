const { ROLES } = require('../config/constants');

/**
 * Injects company_id (and site_id for site supervisors) into req.tenantScope.
 * Every controller MUST use these values when querying tenant data — never trust
 * query params or body values for company/site filtering.
 */
function tenantScope(req, res, next) {
  if (!req.session || !req.session.user) {
    return next();
  }

  const user = req.session.user;

  req.tenantScope = {
    company_id: user.company_id || null,
    // Site supervisors are restricted to their assigned site
    site_id: user.role === ROLES.SITE_SUPERVISOR ? user.site_id : null,
    role: user.role,
    user_id: user.id,
  };

  // Make scope available to all EJS views
  res.locals.tenantScope = req.tenantScope;

  next();
}

/**
 * Asserts that a fetched record belongs to the current tenant.
 * Throws 403 if company_id mismatches. Use in controllers after DB fetch.
 */
function assertTenantOwnership(record, req) {
  if (!record) return; // let controller handle 404
  if (req.tenantScope.role === ROLES.SUPER_ADMIN) return; // super admin can see all
  if (record.company_id !== req.tenantScope.company_id) {
    const err = new Error('Forbidden: cross-tenant access attempt');
    err.status = 403;
    throw err;
  }
}

/**
 * Build a Sequelize WHERE fragment scoped to the current tenant.
 * Pass `allowSiteFilter: true` for resources that are site-scoped.
 */
function scopeWhere(req, extra = {}, { allowSiteFilter = true } = {}) {
  const where = { ...extra };

  if (req.tenantScope.role !== ROLES.SUPER_ADMIN) {
    where.company_id = req.tenantScope.company_id;
  }

  if (allowSiteFilter && req.tenantScope.site_id) {
    where.site_id = req.tenantScope.site_id;
  }

  return where;
}

module.exports = { tenantScope, assertTenantOwnership, scopeWhere };
