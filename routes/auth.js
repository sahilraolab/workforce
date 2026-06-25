const router = require('express').Router();
const { body } = require('express-validator');
const { isGuest } = require('../middlewares/auth');
const ctrl = require('../controllers/authController');

router.get('/login', isGuest, ctrl.showLogin);
router.post('/login', isGuest,
  body('email').isEmail().normalizeEmail().withMessage((v, { req }) => req.t('val_email_required')),
  body('password').notEmpty().withMessage((v, { req }) => req.t('val_password_required')),
  ctrl.login
);

router.post('/logout', ctrl.logout);

module.exports = router;
