const router = require('express').Router();
const { isLoggedIn } = require('../middlewares/auth');
const { can } = require('../middlewares/rbac');
const ctrl = require('../controllers/reportController');

router.get('/', isLoggedIn, can('reports:read'), (req, res) => res.redirect('/reports/compliance'));
router.get('/compliance', isLoggedIn, can('reports:read'), ctrl.compliance);
router.get('/wage', isLoggedIn, can('reports:read'), ctrl.wageReport);
router.get('/pf', isLoggedIn, can('reports:read'), ctrl.pfReport);
router.get('/filings', isLoggedIn, can('reports:read'), ctrl.filingsReport);
router.post('/filings/:type/:month/:year', isLoggedIn, can('payroll:generate'), ctrl.markFiled);
router.get('/audit', isLoggedIn, can('reports:read'), ctrl.auditReport);

module.exports = router;
