const router = require('express').Router();
const { isLoggedIn } = require('../middlewares/auth');
const { can } = require('../middlewares/rbac');
const ctrl = require('../controllers/payrollController');

router.get('/', isLoggedIn, can('payroll:read'), ctrl.index);
router.post('/generate', isLoggedIn, can('payroll:generate'), ctrl.generate);
router.post('/:id/adjust', isLoggedIn, can('payroll:generate'), ctrl.adjust);

module.exports = router;
