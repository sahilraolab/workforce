const fs = require('fs');
const path = require('path');

const SUPPORTED = ['en', 'hi', 'gu', 'mr', 'te'];
const DEFAULT_LANG = 'en';

const dictionaries = SUPPORTED.reduce((acc, code) => {
  acc[code] = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', `${code}.json`), 'utf8'));
  return acc;
}, {});

// Replaces {{varName}} placeholders in a translated string, e.g.
// t('err_worker_limit', { limit: 500 }) with key value
// "Worker limit reached ({{limit}}). Please upgrade your plan."
function interpolate(str, vars) {
  if (!vars) return str;
  return str.replace(/\{\{(\w+)\}\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

function i18n(req, res, next) {
  const lang = SUPPORTED.includes(req.cookies?.lang) ? req.cookies.lang : DEFAULT_LANG;
  const dict = dictionaries[lang];
  const fallback = dictionaries[DEFAULT_LANG];

  const t = (key, vars) => interpolate(dict[key] || fallback[key] || key, vars);

  res.locals.currentLang = lang;
  res.locals.t = t;
  // Also exposed on req so express-validator's withMessage() callbacks
  // (which receive (value, { req })) and other non-view code can translate.
  req.t = t;
  next();
}

module.exports = { i18n, SUPPORTED, DEFAULT_LANG };
