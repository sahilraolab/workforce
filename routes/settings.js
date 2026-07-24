const router = require('express').Router();
const { isLoggedIn } = require('../middlewares/auth');
const { can } = require('../middlewares/rbac');
const ctrl = require('../controllers/settingsController');
const licenseCtrl = require('../controllers/licenseController');

router.get('/', isLoggedIn, (req, res) => res.redirect('/settings/profile'));
router.get('/profile', isLoggedIn, ctrl.profile);
router.post('/profile', isLoggedIn, ctrl.updateProfile);

router.get('/users', isLoggedIn, can('users:manage'), ctrl.users);
router.post('/users', isLoggedIn, can('users:manage'), ctrl.createUser);
router.post('/users/:id/reset-password', isLoggedIn, can('users:manage'), ctrl.resetUserPassword);
router.post('/users/:id/toggle-status', isLoggedIn, can('users:manage'), ctrl.toggleUserStatus);

router.get('/company', isLoggedIn, can('settings:update'), ctrl.companySettings);
router.post('/company', isLoggedIn, can('settings:update'), ctrl.updateCompanySettings);

router.get('/wage-master', isLoggedIn, can('settings:read'), ctrl.wageMaster);
router.post('/wage-master', isLoggedIn, can('settings:update'), ctrl.createWage);

router.get('/licenses', isLoggedIn, can('licenses:manage'), licenseCtrl.list);
router.post('/licenses', isLoggedIn, can('licenses:manage'), licenseCtrl.create);
router.post('/licenses/:id', isLoggedIn, can('licenses:manage'), licenseCtrl.update);
router.post('/licenses/:id/delete', isLoggedIn, can('licenses:manage'), licenseCtrl.remove);

module.exports = router;
