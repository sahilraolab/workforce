const { ROLES } = require('../config/constants');

// Role hierarchy: higher index = more privilege
const ROLE_RANK = {
  [ROLES.AUDITOR]: 0,
  [ROLES.SITE_SUPERVISOR]: 1,
  [ROLES.HR_PAYROLL]: 2,
  [ROLES.COMPANY_ADMIN]: 3,
  [ROLES.SUPER_ADMIN]: 4,
};

// Route-level permission map
const PERMISSIONS = {
  // Workers
  'workers:read': [ROLES.AUDITOR, ROLES.SITE_SUPERVISOR, ROLES.HR_PAYROLL, ROLES.COMPANY_ADMIN, ROLES.SUPER_ADMIN],
  'workers:create': [ROLES.SITE_SUPERVISOR, ROLES.HR_PAYROLL, ROLES.COMPANY_ADMIN, ROLES.SUPER_ADMIN],
  'workers:update': [ROLES.HR_PAYROLL, ROLES.COMPANY_ADMIN, ROLES.SUPER_ADMIN],
  'workers:delete': [ROLES.COMPANY_ADMIN, ROLES.SUPER_ADMIN],

  // Documents
  'documents:read': [ROLES.AUDITOR, ROLES.SITE_SUPERVISOR, ROLES.HR_PAYROLL, ROLES.COMPANY_ADMIN, ROLES.SUPER_ADMIN],
  'documents:upload': [ROLES.SITE_SUPERVISOR, ROLES.HR_PAYROLL, ROLES.COMPANY_ADMIN, ROLES.SUPER_ADMIN],
  'documents:verify': [ROLES.HR_PAYROLL, ROLES.COMPANY_ADMIN, ROLES.SUPER_ADMIN],

  // Attendance
  'attendance:read': [ROLES.AUDITOR, ROLES.SITE_SUPERVISOR, ROLES.HR_PAYROLL, ROLES.COMPANY_ADMIN, ROLES.SUPER_ADMIN],
  'attendance:mark': [ROLES.SITE_SUPERVISOR, ROLES.HR_PAYROLL, ROLES.COMPANY_ADMIN, ROLES.SUPER_ADMIN],

  // Payroll
  'payroll:read': [ROLES.AUDITOR, ROLES.HR_PAYROLL, ROLES.COMPANY_ADMIN, ROLES.SUPER_ADMIN],
  'payroll:generate': [ROLES.HR_PAYROLL, ROLES.COMPANY_ADMIN, ROLES.SUPER_ADMIN],

  // Reports
  'reports:read': [ROLES.AUDITOR, ROLES.HR_PAYROLL, ROLES.COMPANY_ADMIN, ROLES.SUPER_ADMIN],

  // Settings / wage master
  'settings:read': [ROLES.COMPANY_ADMIN, ROLES.SUPER_ADMIN],
  'settings:update': [ROLES.COMPANY_ADMIN, ROLES.SUPER_ADMIN],
  'wage:override': [ROLES.COMPANY_ADMIN, ROLES.SUPER_ADMIN],

  // Company/site management
  'companies:manage': [ROLES.SUPER_ADMIN],
  'sites:manage': [ROLES.COMPANY_ADMIN, ROLES.SUPER_ADMIN],
  'users:manage': [ROLES.COMPANY_ADMIN, ROLES.SUPER_ADMIN],
  'licenses:manage': [ROLES.COMPANY_ADMIN, ROLES.SUPER_ADMIN],

  // Leave approval
  'leaves:approve': [ROLES.SITE_SUPERVISOR, ROLES.HR_PAYROLL, ROLES.COMPANY_ADMIN, ROLES.SUPER_ADMIN],
};

function can(permission) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.redirect('/auth/login');
    }
    const role = req.session.user.role;
    const allowed = PERMISSIONS[permission] || [];
    if (!allowed.includes(role)) {
      req.flash('error', 'You do not have permission to perform this action.');
      return res.status(403).render('errors/403', { title: 'Access Denied' });
    }
    next();
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.redirect('/auth/login');
    }
    if (!roles.includes(req.session.user.role)) {
      req.flash('error', 'You do not have permission to access this area.');
      return res.status(403).render('errors/403', { title: 'Access Denied' });
    }
    next();
  };
}

module.exports = { can, requireRole, PERMISSIONS };
