const router = require('express').Router();
const { isLoggedIn } = require('../middlewares/auth');
const { can } = require('../middlewares/rbac');
const ctrl = require('../controllers/attendanceController');

router.get('/', isLoggedIn, can('attendance:read'), ctrl.daily);
router.post('/mark', isLoggedIn, can('attendance:mark'), ctrl.mark);
router.get('/muster-roll', isLoggedIn, can('attendance:read'), ctrl.musterRoll);
router.get('/leaves', isLoggedIn, can('attendance:read'), ctrl.leaveList);
router.post('/leaves', isLoggedIn, ctrl.applyLeave);
router.post('/leaves/:id/action', isLoggedIn, can('leaves:approve'), ctrl.approveLeave);

module.exports = router;
