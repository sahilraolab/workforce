const router = require('express').Router();
const { isLoggedIn } = require('../middlewares/auth');
const ctrl = require('../controllers/dashboardController');

router.get('/', isLoggedIn, ctrl.index);

module.exports = router;
