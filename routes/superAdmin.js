const router = require('express').Router();
const { isLoggedIn } = require('../middlewares/auth');
const { requireRole } = require('../middlewares/rbac');
const { body } = require('express-validator');
const ctrl = require('../controllers/companyController');
const { ROLES, SUBSCRIPTION_PLANS } = require('../config/constants');

const SA = requireRole(ROLES.SUPER_ADMIN);
const PLAN_KEYS = Object.keys(SUBSCRIPTION_PLANS).map(k => k.toLowerCase());

const companyFieldRules = [
  body('name').trim().notEmpty().withMessage((v, { req }) => req.t('val_company_name_required'))
    .isLength({ max: 255 }).withMessage((v, { req }) => req.t('val_company_name_max')),
  body('contact_email').optional({ checkFalsy: true }).isEmail().withMessage((v, { req }) => req.t('val_contact_email_format')),
  body('contact_phone').optional({ checkFalsy: true }).matches(/^\d{10}$/).withMessage((v, { req }) => req.t('val_contact_phone_format')),
  body('plan').isIn(PLAN_KEYS).withMessage((v, { req }) => req.t('val_plan_required')),
  body('worker_limit').optional({ checkFalsy: true }).isInt({ min: 1 }).withMessage((v, { req }) => req.t('val_worker_limit_format')),
  body('end_date').notEmpty().withMessage((v, { req }) => req.t('val_end_date_required'))
    .isDate().withMessage((v, { req }) => req.t('val_end_date_format'))
    .custom((val, { req }) => {
      // Compare calendar dates only (allow "today").
      const today = new Date(); today.setHours(0, 0, 0, 0);
      if (new Date(val) < today) throw new Error(req.t('val_end_date_future'));
      return true;
    }),
];

const companyValidation = [
  ...companyFieldRules,
  body('admin_name').trim().notEmpty().withMessage((v, { req }) => req.t('val_admin_name_required')),
  body('admin_email').isEmail().withMessage((v, { req }) => req.t('val_admin_email_required')).normalizeEmail(),
  body('admin_password').isLength({ min: 8 }).withMessage((v, { req }) => req.t('val_admin_password_min')),
  body('admin_password_confirm').custom((val, { req }) => {
    if (val !== req.body.admin_password) throw new Error(req.t('val_password_mismatch'));
    return true;
  }),
];

const companyUpdateValidation = [
  ...companyFieldRules,
  body('status').isIn(['active', 'suspended', 'trial']).withMessage((v, { req }) => req.t('val_status_required')),
];

router.get('/companies', isLoggedIn, SA, ctrl.list);
router.get('/companies/new', isLoggedIn, SA, ctrl.showCreate);
router.post('/companies', isLoggedIn, SA, companyValidation, ctrl.create);
router.get('/companies/:id/edit', isLoggedIn, SA, ctrl.showEdit);
router.put('/companies/:id', isLoggedIn, SA, companyUpdateValidation, ctrl.update);

// Companies and Subscriptions were merged into one screen — subscription
// detail (plan, status, worker limit, period) now lives as extra columns
// on /admin/companies. Old bookmarks/links redirect rather than 404.
router.get('/subscriptions', isLoggedIn, SA, (req, res) => res.redirect('/admin/companies'));

module.exports = router;
