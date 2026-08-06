const path = require('path');
const fs = require('fs');
const { Document, Worker, Site, Company } = require('../models');
const { assertTenantOwnership, scopeWhere } = require('../middlewares/tenantScope');
const { logAudit } = require('../middlewares/auditLogger');
const gen = require('../services/documentGenerator');

// ─── File serving (uploaded docs) ────────────────────────────────────────────

exports.serve = async (req, res) => {
  try {
    const doc = await Document.findByPk(req.params.id, {
      include: [{ model: Worker, as: 'worker' }],
    });
    if (!doc) return res.status(404).send('Document not found.');
    assertTenantOwnership(doc.worker, req);

    if (!fs.existsSync(doc.file_path)) return res.status(404).send('File not found on server.');

    const ext = path.extname(doc.file_path).toLowerCase();
    const mimeMap = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
    const mime = doc.mime_type || mimeMap[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${doc.original_name || 'document'}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(doc.file_path).pipe(res);
  } catch (err) {
    if (err.status === 403) return res.status(403).send('Access denied.');
    console.error(err);
    res.status(500).send('Server error.');
  }
};

// ─── Document verify / reject ─────────────────────────────────────────────────

exports.verify = async (req, res) => {
  try {
    const doc = await Document.findByPk(req.params.id, { include: [{ model: Worker, as: 'worker' }] });
    if (!doc) { req.flash('error', res.locals.t('err_document_not_found')); return res.redirect('back'); }
    assertTenantOwnership(doc.worker, req);
    const before = { status: doc.status };
    await doc.update({ status: 'verified', verified_by: req.session.user.id, verified_at: new Date(), updated_by: req.session.user.id });
    await logAudit(req, { action: 'verify', entity: 'Document', entity_id: doc.id, before_value: before, after_value: { status: 'verified' } });
    req.flash('success', res.locals.t('ok_document_verified'));
    res.redirect(`/workers/${doc.worker_id}`);
  } catch (err) {
    if (err.status === 403) { req.flash('error', res.locals.t('err_access_denied')); return res.redirect('back'); }
    console.error(err);
    req.flash('error', res.locals.t('err_verify_document'));
    res.redirect('back');
  }
};

exports.reject = async (req, res) => {
  try {
    const doc = await Document.findByPk(req.params.id, { include: [{ model: Worker, as: 'worker' }] });
    if (!doc) { req.flash('error', res.locals.t('err_document_not_found')); return res.redirect('back'); }
    assertTenantOwnership(doc.worker, req);
    const before = { status: doc.status };
    await doc.update({ status: 'rejected', rejection_reason: req.body.reason || '', updated_by: req.session.user.id });
    await logAudit(req, { action: 'reject', entity: 'Document', entity_id: doc.id, before_value: before, after_value: { status: 'rejected', reason: req.body.reason } });
    req.flash('success', res.locals.t('ok_document_rejected'));
    res.redirect(`/workers/${doc.worker_id}`);
  } catch (err) {
    console.error(err);
    req.flash('error', res.locals.t('err_reject_document'));
    res.redirect('back');
  }
};

// ─── Generate hub page ────────────────────────────────────────────────────────

exports.generateHub = async (req, res) => {
  try {
    const now = new Date();
    const selectedMonth = parseInt(req.query.month) || now.getMonth() + 1;
    const selectedYear = parseInt(req.query.year) || now.getFullYear();
    const selectedSite = req.query.site_id || null;

    const sites = await Site.findAll({ where: scopeWhere(req, {}, { allowSiteFilter: false }), attributes: ['id', 'name'] });

    const workerWhere = scopeWhere(req, { status: 'active' });
    if (selectedSite) workerWhere.site_id = selectedSite;
    const workers = await Worker.findAll({
      where: workerWhere,
      include: [{ model: Site, as: 'site', attributes: ['id', 'name'] }],
      order: [['name', 'ASC']],
      attributes: ['id', 'name', 'site_id'],
    });

    res.render('documents/generate', { title: 'Generate Documents', sites, workers, selectedMonth, selectedYear, selectedSite });
  } catch (err) {
    console.error(err);
    req.flash('error', res.locals.t('err_server'));
    res.redirect('/dashboard');
  }
};

// ─── Shared tenant check for per-worker docs ──────────────────────────────────

async function checkWorkerAccess(workerId, req) {
  const worker = await Worker.findByPk(workerId);
  if (!worker) throw Object.assign(new Error('Worker not found'), { status: 404 });
  assertTenantOwnership(worker, req);
  return worker;
}

function handleDocError(err, req, res, fallback) {
  if (err.status === 403) { req.flash('error', 'Access denied.'); return res.redirect(fallback); }
  if (err.status === 404) { req.flash('error', err.message); return res.redirect(fallback); }
  console.error('Document generation error:', err);
  req.flash('error', 'Could not generate document. Please try again.');
  res.redirect(fallback);
}

// ─── Per-worker document routes ───────────────────────────────────────────────

exports.salarySlip = async (req, res) => {
  try {
    const workerId = parseInt(req.params.workerId);
    const month = parseInt(req.query.month);
    const year = parseInt(req.query.year);
    if (!month || !year || month < 1 || month > 12 || year < 2000) {
      req.flash('error', 'Provide a valid month and year.'); return res.redirect(`/workers/${workerId}`);
    }
    await checkWorkerAccess(workerId, req);
    const { html } = await gen.renderSalarySlipHtml(workerId, month, year);
    await logAudit(req, { action: 'generate', entity: 'Document', entity_id: workerId, after_value: { doc_type: 'salary_slip', month, year } });
    res.send(html);
  } catch (err) { handleDocError(err, req, res, `/workers/${req.params.workerId}`); }
};

exports.offerLetter = async (req, res) => {
  try {
    const workerId = parseInt(req.params.workerId);
    await checkWorkerAccess(workerId, req);
    const html = await gen.renderOfferLetter(workerId);
    await logAudit(req, { action: 'generate', entity: 'Document', entity_id: workerId, after_value: { doc_type: 'offer_letter' } });
    res.send(html);
  } catch (err) { handleDocError(err, req, res, '/documents/generate'); }
};

exports.serviceCertificate = async (req, res) => {
  try {
    const workerId = parseInt(req.params.workerId);
    await checkWorkerAccess(workerId, req);
    const html = await gen.renderServiceCertificate(workerId);
    await logAudit(req, { action: 'generate', entity: 'Document', entity_id: workerId, after_value: { doc_type: 'service_certificate' } });
    res.send(html);
  } catch (err) { handleDocError(err, req, res, '/documents/generate'); }
};

exports.epfForm2 = async (req, res) => {
  try {
    const workerId = parseInt(req.params.workerId);
    await checkWorkerAccess(workerId, req);
    const html = await gen.renderEpfForm2(workerId);
    await logAudit(req, { action: 'generate', entity: 'Document', entity_id: workerId, after_value: { doc_type: 'epf_form2' } });
    res.send(html);
  } catch (err) { handleDocError(err, req, res, '/documents/generate'); }
};

exports.esicForm1 = async (req, res) => {
  try {
    const workerId = parseInt(req.params.workerId);
    await checkWorkerAccess(workerId, req);
    const html = await gen.renderEsicForm1(workerId);
    await logAudit(req, { action: 'generate', entity: 'Document', entity_id: workerId, after_value: { doc_type: 'esic_form1' } });
    res.send(html);
  } catch (err) { handleDocError(err, req, res, '/documents/generate'); }
};

// ─── Site-wide document routes ────────────────────────────────────────────────

exports.musterRoll = async (req, res) => {
  try {
    const companyId = req.tenantScope.company_id;
    const siteId = req.query.site_id || null;
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const html = await gen.renderMusterRoll(companyId, siteId, month, year);
    await logAudit(req, { action: 'generate', entity: 'Document', after_value: { doc_type: 'muster_roll', month, year, siteId } });
    res.send(html);
  } catch (err) { handleDocError(err, req, res, '/documents/generate'); }
};

exports.wageRegister = async (req, res) => {
  try {
    const companyId = req.tenantScope.company_id;
    const siteId = req.query.site_id || null;
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const html = await gen.renderWageRegister(companyId, siteId, month, year);
    await logAudit(req, { action: 'generate', entity: 'Document', after_value: { doc_type: 'wage_register', month, year, siteId } });
    res.send(html);
  } catch (err) { handleDocError(err, req, res, '/documents/generate'); }
};

exports.employmentRegister = async (req, res) => {
  try {
    const companyId = req.tenantScope.company_id;
    const siteId = req.query.site_id || null;
    const html = await gen.renderEmploymentRegister(companyId, siteId);
    await logAudit(req, { action: 'generate', entity: 'Document', after_value: { doc_type: 'employment_register', siteId } });
    res.send(html);
  } catch (err) { handleDocError(err, req, res, '/documents/generate'); }
};

exports.leaveRegister = async (req, res) => {
  try {
    const companyId = req.tenantScope.company_id;
    const siteId = req.query.site_id || null;
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const html = await gen.renderLeaveRegister(companyId, siteId, month, year);
    await logAudit(req, { action: 'generate', entity: 'Document', after_value: { doc_type: 'leave_register', month, year, siteId } });
    res.send(html);
  } catch (err) { handleDocError(err, req, res, '/documents/generate'); }
};

exports.adultWorkerRegister = async (req, res) => {
  try {
    const companyId = req.tenantScope.company_id;
    const siteId = req.query.site_id || null;
    const html = await gen.renderAdultWorkerRegister(companyId, siteId);
    await logAudit(req, { action: 'generate', entity: 'Document', after_value: { doc_type: 'adult_worker_register', siteId } });
    res.send(html);
  } catch (err) { handleDocError(err, req, res, '/documents/generate'); }
};

exports.leaveCard = async (req, res) => {
  try {
    const workerId = parseInt(req.params.workerId);
    const year = parseInt(req.query.year) || new Date().getFullYear();
    await checkWorkerAccess(workerId, req);
    const html = await gen.renderLeaveCard(workerId, year);
    await logAudit(req, { action: 'generate', entity: 'Document', entity_id: workerId, after_value: { doc_type: 'leave_card', year } });
    res.send(html);
  } catch (err) { handleDocError(err, req, res, '/documents/generate'); }
};

exports.annualReturn = async (req, res) => {
  try {
    const companyId = req.tenantScope.company_id;
    const year = parseInt(req.query.year) || new Date().getFullYear() - 1;
    const html = await gen.renderAnnualReturn(companyId, year);
    await logAudit(req, { action: 'generate', entity: 'Document', after_value: { doc_type: 'annual_return', year } });
    res.send(html);
  } catch (err) { handleDocError(err, req, res, '/documents/generate'); }
};

exports.halfYearlyReturn = async (req, res) => {
  try {
    const companyId = req.tenantScope.company_id;
    const half = parseInt(req.query.half) === 2 ? 2 : 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const html = await gen.renderHalfYearlyReturn(companyId, half, year);
    await logAudit(req, { action: 'generate', entity: 'Document', after_value: { doc_type: 'half_yearly_return', half, year } });
    res.send(html);
  } catch (err) { handleDocError(err, req, res, '/documents/generate'); }
};

// ─── Pending list ─────────────────────────────────────────────────────────────

exports.pendingList = async (req, res) => {
  const workerWhere = scopeWhere(req, { status: 'active' });
  const docs = await Document.findAll({
    where: { status: 'pending' },
    include: [{ model: Worker, as: 'worker', where: workerWhere }],
    order: [['created_at', 'ASC']],
  });
  res.render('documents/pending', { title: res.locals.t('documents_pending_title'), docs });
};
