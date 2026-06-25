const router = require('express').Router();
const { isLoggedIn } = require('../middlewares/auth');
const { can } = require('../middlewares/rbac');
const ctrl = require('../controllers/documentController');

router.get('/pending', isLoggedIn, can('documents:verify'), ctrl.pendingList);
router.get('/:id', isLoggedIn, can('documents:read'), ctrl.serve);
router.post('/:id/verify', isLoggedIn, can('documents:verify'), ctrl.verify);
router.post('/:id/reject', isLoggedIn, can('documents:verify'), ctrl.reject);

module.exports = router;
