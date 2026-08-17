const router = require('express').Router();
const { body } = require('express-validator');
const { isLoggedIn } = require('../middlewares/auth');
const { can } = require('../middlewares/rbac');
const { workerUpload, csvUpload, handleUploadError } = require('../middlewares/upload');
const ctrl = require('../controllers/workerController');

// Personal details validators (now the Step 2 form — documents come first)
const personalRules = [
  body('site_id').notEmpty().withMessage((v, { req }) => req.t('val_site_required')),
  body('name').trim().notEmpty().withMessage((v, { req }) => req.t('val_worker_name_required')),
  body('father_name').trim().notEmpty().withMessage((v, { req }) => req.t('val_father_name_required')),
  body('dob').isDate().withMessage((v, { req }) => req.t('val_dob_required')),
  body('gender').isIn(['Male', 'Female', 'Other']).withMessage((v, { req }) => req.t('val_gender_required')),
  body('aadhaar').matches(/^\d{12}$/).withMessage((v, { req }) => req.t('val_aadhaar_format')),
  body('pan_number').optional({ checkFalsy: true }).trim().toUpperCase().matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/).withMessage('PAN must be 10 characters, e.g. ABCPS1234F.'),
  body('address_aadhaar').trim().notEmpty().withMessage((v, { req }) => req.t('val_aadhaar_address_required')),
  body('mobile').matches(/^\d{10}$/).withMessage((v, { req }) => req.t('val_mobile_format')),
  body('marital_status').notEmpty().withMessage((v, { req }) => req.t('val_marital_status_required')),
];

// Employment & bank validators (now the Step 3 form)
const employmentRules = [
  body('category').notEmpty().withMessage((v, { req }) => req.t('val_category_required')),
  body('zone').notEmpty().withMessage((v, { req }) => req.t('val_zone_required')),
  body('wage_rate').isFloat({ min: 0 }).withMessage((v, { req }) => req.t('val_wage_rate_required')),
  body('doj').isDate().withMessage((v, { req }) => req.t('val_doj_required')),
  body('uan').optional({ checkFalsy: true }).matches(/^\d{12}$/).withMessage((v, { req }) => req.t('val_uan_format')),
  body('esic_number').custom((val, { req }) => {
    if (req.body.esic_applicable === 'yes') {
      if (!val || !/^\d{17}$/.test(val)) throw new Error(req.t('val_esic_format'));
    }
    return true;
  }),
];

router.get('/', isLoggedIn, can('workers:read'), ctrl.list);

// Wizard — documents first: uploads run through OCR on submit, and the
// extracted fields pre-fill the Personal Details step that follows.
router.get('/register', isLoggedIn, can('workers:create'), ctrl.showRegister);
router.post('/register/step1', isLoggedIn, can('workers:create'),
  workerUpload.fields([
    { name: 'aadhaar', maxCount: 1 },
    { name: 'aadhaar_back', maxCount: 1 },
    { name: 'pan_card', maxCount: 1 },
    { name: 'passport_photo', maxCount: 1 },
    { name: 'bank_passbook', maxCount: 1 },
    { name: 'uan_card', maxCount: 1 },
    { name: 'esic_card', maxCount: 1 },
  ]),
  handleUploadError,
  ctrl.saveStep1
);
router.get('/register/step2', isLoggedIn, can('workers:create'), ctrl.showStep2);
router.post('/register/step2', isLoggedIn, can('workers:create'), personalRules, ctrl.saveStep2);
router.get('/register/step3', isLoggedIn, can('workers:create'), ctrl.showStep3);
router.post('/register/step3', isLoggedIn, can('workers:create'), employmentRules, ctrl.saveStep3);
router.get('/register/step4', isLoggedIn, can('workers:create'), ctrl.showStep4);
router.post('/register/step4', isLoggedIn, can('workers:create'),
  workerUpload.fields(
    Array.from({ length: 10 }, (_, i) => ({ name: `family_photo_${i}`, maxCount: 1 }))
  ),
  handleUploadError,
  ctrl.saveStep4
);
router.get('/register/step5', isLoggedIn, can('workers:create'), ctrl.showStep5);
router.post('/register/submit', isLoggedIn, can('workers:create'), ctrl.submit);
router.post('/register/save-draft', isLoggedIn, can('workers:create'), ctrl.saveDraft);
router.get('/register/exit', isLoggedIn, ctrl.exitRegistration);

router.get('/import-template', isLoggedIn, can('workers:create'), ctrl.downloadTemplate);
router.post('/import', isLoggedIn, can('workers:create'), csvUpload.single('file'), handleUploadError, ctrl.importCsv);

router.get('/:id', isLoggedIn, can('workers:read'), ctrl.show);
router.post('/:id/acknowledge-check', isLoggedIn, can('workers:update'), ctrl.acknowledgeCheck);
router.delete('/:id', isLoggedIn, can('workers:delete'), ctrl.destroy);

module.exports = router;
