function isLoggedIn(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  req.flash('error', 'Please log in to continue.');
  res.redirect('/auth/login');
}

function isGuest(req, res, next) {
  if (req.session && req.session.user) {
    return res.redirect('/dashboard');
  }
  next();
}

module.exports = { isLoggedIn, isGuest };
