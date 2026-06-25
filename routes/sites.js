const router = require('express').Router();
const { body } = require('express-validator');
const { isLoggedIn } = require('../middlewares/auth');
const { can } = require('../middlewares/rbac');
const ctrl = require('../controllers/siteController');

const siteValidation = [
  body('name').trim().notEmpty().withMessage((v, { req }) => req.t('val_site_name_required')),
  body('location').trim().optional(),
];

router.get('/', isLoggedIn, can('sites:manage'), ctrl.list);
router.get('/new', isLoggedIn, can('sites:manage'), ctrl.showCreate);
router.post('/', isLoggedIn, can('sites:manage'), siteValidation, ctrl.create);
router.get('/:id/edit', isLoggedIn, can('sites:manage'), ctrl.showEdit);
router.put('/:id', isLoggedIn, can('sites:manage'), siteValidation, ctrl.update);

module.exports = router;
