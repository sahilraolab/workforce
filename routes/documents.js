const router = require('express').Router();
const { isLoggedIn } = require('../middlewares/auth');
const { can } = require('../middlewares/rbac');
const ctrl = require('../controllers/documentController');

// Hub page
router.get('/generate', isLoggedIn, can('documents:read'), ctrl.generateHub);

// Site-wide generated docs
router.get('/muster-roll',            isLoggedIn, can('documents:read'), ctrl.musterRoll);
router.get('/wage-register',          isLoggedIn, can('documents:read'), ctrl.wageRegister);
router.get('/employment-register',    isLoggedIn, can('documents:read'), ctrl.employmentRegister);
router.get('/leave-register',         isLoggedIn, can('documents:read'), ctrl.leaveRegister);
router.get('/adult-worker-register',  isLoggedIn, can('documents:read'), ctrl.adultWorkerRegister);
router.get('/annual-return',          isLoggedIn, can('documents:read'), ctrl.annualReturn);
router.get('/half-yearly-return',     isLoggedIn, can('documents:read'), ctrl.halfYearlyReturn);

// Per-worker generated docs
router.get('/salary-slip/:workerId',        isLoggedIn, can('documents:read'), ctrl.salarySlip);
router.get('/offer-letter/:workerId',       isLoggedIn, can('documents:read'), ctrl.offerLetter);
router.get('/service-certificate/:workerId',isLoggedIn, can('documents:read'), ctrl.serviceCertificate);
router.get('/epf-form2/:workerId',          isLoggedIn, can('documents:read'), ctrl.epfForm2);
router.get('/esic-form1/:workerId',         isLoggedIn, can('documents:read'), ctrl.esicForm1);
router.get('/leave-card/:workerId',         isLoggedIn, can('documents:read'), ctrl.leaveCard);

// Uploaded document serving / management
router.get('/pending',  isLoggedIn, can('documents:verify'), ctrl.pendingList);
router.get('/:id',      isLoggedIn, can('documents:read'),   ctrl.serve);
router.post('/:id/verify', isLoggedIn, can('documents:verify'), ctrl.verify);
router.post('/:id/reject', isLoggedIn, can('documents:verify'), ctrl.reject);

module.exports = router;
