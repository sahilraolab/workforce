require('dotenv').config();

const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const helmet = require('helmet');
const csrf = require('csurf');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const methodOverride = require('method-override');
const flash = require('connect-flash');
const cookieParser = require('cookie-parser');
const path = require('path');

const { sequelize } = require('./models');
const { tenantScope } = require('./middlewares/tenantScope');
const { i18n, SUPPORTED: SUPPORTED_LANGS } = require('./middlewares/i18n');

// ─── Routes ─────────────────────────────────────────────────────────────────
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const companyRoutes = require('./routes/companies');
const siteRoutes = require('./routes/sites');
const workerRoutes = require('./routes/workers');
const documentRoutes = require('./routes/documents');
const attendanceRoutes = require('./routes/attendance');
const payrollRoutes = require('./routes/payroll');
const reportRoutes = require('./routes/reports');
const settingsRoutes = require('./routes/settings');
const superAdminRoutes = require('./routes/superAdmin');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust the Nginx reverse proxy (required for secure cookies + rate-limit IP detection)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// ─── Session Store ───────────────────────────────────────────────────────────
const sessionStore = new MySQLStore({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  clearExpired: true,
  checkExpirationInterval: 900000,
  expiration: parseInt(process.env.SESSION_MAX_AGE_MS || '28800000', 10),
});

// ─── Security Middleware ─────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'unpkg.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net'],
      fontSrc: ["'self'", 'cdn.jsdelivr.net'],
      imgSrc: ["'self'", 'data:', 'blob:'],
    },
  },
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: 'Too many login attempts, please try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── General Middleware ──────────────────────────────────────────────────────
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Session ─────────────────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'change_this_secret',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  name: 'wfsid',
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: parseInt(process.env.SESSION_MAX_AGE_MS || '28800000', 10),
  },
}));

app.use(flash());

// ─── CSRF ────────────────────────────────────────────────────────────────────
const csrfProtection = csrf({ cookie: false });
app.use(csrfProtection);

// ─── Tenant Scope ────────────────────────────────────────────────────────────
app.use(tenantScope);

// ─── View Engine ─────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');
app.set('layout extractScripts', true);
app.set('layout extractStyles', true);

// ─── Global Template Locals ──────────────────────────────────────────────────
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.info = req.flash('info');
  // Structured one-time payload for "here is a generated password" UI
  // (user creation / password reset) — kept separate from the plain-text
  // flash messages above so the view can render it as a proper copyable
  // field instead of embedding the secret inside a sentence.
  res.locals.generatedPasswordFor = req.flash('generatedPasswordFor')[0] || null;
  res.locals.generatedPassword = req.flash('generatedPassword')[0] || null;
  res.locals.csrfToken = req.csrfToken();
  res.locals.APP_NAME = process.env.APP_NAME || 'WorkforceSaaS';
  res.locals.currentPath = req.path;
  next();
});
app.use(i18n);

// ─── Language switch ──────────────────────────────────────────────────────────
app.get('/lang/:code', (req, res) => {
  if (SUPPORTED_LANGS.includes(req.params.code)) {
    res.cookie('lang', req.params.code, { maxAge: 365 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
  }
  res.redirect(req.get('Referer') || '/dashboard');
});

// ─── Routes ──────────────────────────────────────────────────────────────────
// Rate limiting is a real security control in production but gets in the way
// of repeated manual testing in development — only apply it outside dev.
if (process.env.NODE_ENV === 'development') {
  app.use('/auth', authRoutes);
} else {
  app.use('/auth', loginLimiter, authRoutes);
}
app.use('/dashboard', dashboardRoutes);
app.use('/companies', companyRoutes);
app.use('/sites', siteRoutes);
app.use('/workers', workerRoutes);
app.use('/documents', documentRoutes);
app.use('/attendance', attendanceRoutes);
app.use('/payroll', payrollRoutes);
app.use('/reports', reportRoutes);
app.use('/settings', settingsRoutes);
app.use('/admin', superAdminRoutes);
app.use('/api', apiRoutes);

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.redirect('/auth/login');
});

// ─── Error Handlers ──────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('errors/404', { title: 'Page Not Found', layout: 'layout' });
});

app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    req.flash('error', 'Your session expired or the form was tampered with. Please try again.');
    return res.redirect('back');
  }
  console.error(err.stack);
  const status = err.status || 500;
  res.status(status).render('errors/500', {
    title: 'Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred.',
    layout: 'layout',
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────
async function start() {
  try {
    await sequelize.authenticate();
    console.log('Database connected.');
    // In production never auto-alter schema — run migrations manually before restart
    await sequelize.sync({ alter: process.env.NODE_ENV !== 'production' });
    console.log('Models synced.');

    // Start cron jobs
    require('./jobs/notificationJob');
    require('./jobs/complianceSnapshotJob');

    app.listen(PORT, () => {
      console.log(`WorkforceSaaS running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();

module.exports = app;
