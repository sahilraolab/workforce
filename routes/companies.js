const router = require('express').Router();
const { body } = require('express-validator');
const { isLoggedIn } = require('../middlewares/auth');
const { requireRole } = require('../middlewares/rbac');
const ctrl = require('../controllers/companyController');
const { ROLES } = require('../config/constants');

// Company listing accessible by company_admin for their own company
router.get('/', isLoggedIn, requireRole(ROLES.COMPANY_ADMIN, ROLES.SUPER_ADMIN), ctrl.list);

module.exports = router;
