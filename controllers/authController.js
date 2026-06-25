const bcrypt = require('bcrypt');
const { validationResult } = require('express-validator');
const { User, Company } = require('../models');

exports.showLogin = (req, res) => {
  res.render('auth/login', { title: 'Login', layout: false });
};

exports.login = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array().map(e => e.msg).join(', '));
    return res.redirect('/auth/login');
  }

  const { email, password } = req.body;
  const t = res.locals.t;

  try {
    const user = await User.findOne({
      where: { email: email.toLowerCase().trim() },
      include: [{ model: Company, as: 'company', attributes: ['name', 'status'] }],
    });

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      req.flash('error', t('err_invalid_credentials'));
      return res.redirect('/auth/login');
    }

    if (user.status !== 'active') {
      req.flash('error', t('err_account_inactive'));
      return res.redirect('/auth/login');
    }

    if (user.company && user.company.status === 'suspended') {
      req.flash('error', t('err_company_suspended'));
      return res.redirect('/auth/login');
    }

    // Regenerate session to prevent fixation
    req.session.regenerate(err => {
      if (err) {
        req.flash('error', t('err_session'));
        return res.redirect('/auth/login');
      }
      req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        company_id: user.company_id,
        site_id: user.site_id,
        company_name: user.company ? user.company.name : null,
      };
      user.update({ last_login_at: new Date() }).catch(() => {});
      res.redirect('/dashboard');
    });
  } catch (err) {
    console.error('Login error:', err);
    req.flash('error', t('err_server_retry'));
    res.redirect('/auth/login');
  }
};

exports.logout = (req, res) => {
  req.session.destroy(err => {
    if (err) console.error('Logout error:', err);
    res.clearCookie('wfsid');
    res.redirect('/auth/login');
  });
};
