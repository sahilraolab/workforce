const path = require('path');
const fs = require('fs');
const { Document, Worker } = require('../models');
const { assertTenantOwnership } = require('../middlewares/tenantScope');
const { logAudit } = require('../middlewares/auditLogger');

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

exports.verify = async (req, res) => {
  try {
    const doc = await Document.findByPk(req.params.id, {
      include: [{ model: Worker, as: 'worker' }],
    });
    if (!doc) { req.flash('error', res.locals.t('err_document_not_found')); return res.redirect('back'); }
    assertTenantOwnership(doc.worker, req);

    const before = { status: doc.status };
    await doc.update({
      status: 'verified',
      verified_by: req.session.user.id,
      verified_at: new Date(),
      updated_by: req.session.user.id,
    });

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
    const doc = await Document.findByPk(req.params.id, {
      include: [{ model: Worker, as: 'worker' }],
    });
    if (!doc) { req.flash('error', res.locals.t('err_document_not_found')); return res.redirect('back'); }
    assertTenantOwnership(doc.worker, req);

    const before = { status: doc.status };
    await doc.update({
      status: 'rejected',
      rejection_reason: req.body.reason || '',
      updated_by: req.session.user.id,
    });

    await logAudit(req, { action: 'reject', entity: 'Document', entity_id: doc.id, before_value: before, after_value: { status: 'rejected', reason: req.body.reason } });
    req.flash('success', res.locals.t('ok_document_rejected'));
    res.redirect(`/workers/${doc.worker_id}`);
  } catch (err) {
    console.error(err);
    req.flash('error', res.locals.t('err_reject_document'));
    res.redirect('back');
  }
};

exports.pendingList = async (req, res) => {
  const { Worker: W } = require('../models');
  const { scopeWhere } = require('../middlewares/tenantScope');
  const workerWhere = scopeWhere(req, { status: 'active' });

  const docs = await Document.findAll({
    where: { status: 'pending' },
    include: [{ model: W, as: 'worker', where: workerWhere }],
    order: [['created_at', 'ASC']],
  });

  res.render('documents/pending', { title: res.locals.t('documents_pending_title'), docs });
};
