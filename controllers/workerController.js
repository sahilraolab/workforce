const { validationResult } = require('express-validator');
const { Op } = require('sequelize');
const { parse: parseCsv } = require('csv-parse/sync');
const { Parser: CsvParser } = require('json2csv');
const {
  Worker, EmploymentDetail, Document, FamilyMember, Site,
  WageMaster, ValidationResult, Subscription,
} = require('../models');
const { encrypt, decrypt } = require('../services/cryptoService');
const ocrService = require('../services/ocrService');
const { scopeWhere, assertTenantOwnership } = require('../middlewares/tenantScope');
const { logAudit } = require('../middlewares/auditLogger');
const { runValidation } = require('../services/validationEngine');
const { paginate, buildPageData } = require('../utils/pagination');
const { ROLES, WORKER_CATEGORIES, ZONES } = require('../config/constants');
const path = require('path');
const fs = require('fs');

// Super admins have no company of their own — when registering a worker on
// behalf of a company, the company must be derived from the selected site.
async function resolveDraftCompanyId(req) {
  if (req.tenantScope.company_id) return req.tenantScope.company_id;
  const siteId = req.session.workerDraft && req.session.workerDraft.site_id;
  if (!siteId) return null;
  const site = await Site.findByPk(siteId, { attributes: ['company_id'] });
  return site ? site.company_id : null;
}

const IMPORT_COLUMNS = [
  'site_name', 'name', 'father_name', 'dob', 'gender', 'aadhaar', 'address_aadhaar',
  'mobile', 'email', 'marital_status', 'category', 'zone', 'wage_rate', 'doj',
  'uan', 'esic_applicable', 'esic_number', 'bank_account', 'ifsc_code',
];

// ─── List ────────────────────────────────────────────────────────────────────

exports.list = async (req, res) => {
  try {
    const { page, limit, offset } = paginate(req.query);
    const where = scopeWhere(req, {});
    if (req.query.status) where.status = req.query.status;
    if (req.query.site_id) where.site_id = req.query.site_id;
    if (req.query.search) {
      where[Op.or] = [
        { name: { [Op.like]: `%${req.query.search}%` } },
        { mobile: { [Op.like]: `%${req.query.search}%` } },
        { aadhaar_last4: { [Op.like]: `%${req.query.search}%` } },
      ];
    }

    // CSV export — same filters as the list, but every matching row (no pagination).
    if (req.query.export === 'csv') {
      const allWorkers = await Worker.findAll({
        where,
        include: [
          { model: Site, as: 'site', attributes: ['id', 'name'] },
          { model: EmploymentDetail, as: 'employment', attributes: ['category', 'zone', 'wage_rate', 'doj'] },
        ],
        order: [['created_at', 'DESC']],
      });
      const fields = ['Name', "Father's Name", 'Site', 'Mobile', 'Category', 'Zone', 'Daily Wage', 'Date of Joining', 'Status', 'Aadhaar (last 4)'];
      const data = allWorkers.map(w => ({
        'Name': w.name,
        "Father's Name": w.father_name,
        'Site': w.site ? w.site.name : '',
        'Mobile': w.mobile,
        'Category': w.employment ? w.employment.category : '',
        'Zone': w.employment ? w.employment.zone : '',
        'Daily Wage': w.employment ? w.employment.wage_rate : '',
        'Date of Joining': w.employment ? w.employment.doj : '',
        'Status': w.status,
        'Aadhaar (last 4)': w.aadhaar_last4 ? `••••${w.aadhaar_last4}` : '',
      }));
      const parser = new CsvParser({ fields });
      const csv = parser.parse(data);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="workers-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send(csv);
    }

    const { count, rows: workers } = await Worker.findAndCountAll({
      where,
      include: [
        { model: Site, as: 'site', attributes: ['id', 'name'] },
        { model: EmploymentDetail, as: 'employment', attributes: ['category', 'zone', 'wage_rate', 'doj'] },
      ],
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    const sites = await Site.findAll({
      where: scopeWhere(req, {}, { allowSiteFilter: false }),
      attributes: ['id', 'name'],
    });

    res.render('workers/list', {
      title: 'Workers',
      workers,
      sites,
      pageData: buildPageData(count, page, limit),
      query: req.query,
      pendingDraft: req.session.workerDraft || null,
    });
  } catch (err) {
    console.error(err);
    req.flash('error', res.locals.t('err_load_workers'));
    res.redirect('/dashboard');
  }
};

// ─── Bulk Import / Export ──────────────────────────────────────────────────────

exports.downloadTemplate = (req, res) => {
  // Built with json2csv (not manual string-join) so any field containing a
  // comma — like the example address — is correctly quoted/escaped.
  const example = {
    site_name: 'Main Site', name: 'Ramesh Kumar', father_name: 'Suresh Kumar',
    dob: '1990-05-15', gender: 'Male', aadhaar: '234123412346',
    address_aadhaar: '12, MG Road, Mumbai, Maharashtra', mobile: '9876543210',
    email: '', marital_status: 'Married', category: 'Unskilled', zone: 'Zone 1',
    wage_rate: '500', doj: '2024-01-15', uan: '', esic_applicable: 'no',
    esic_number: '', bank_account: '123456789012', ifsc_code: 'HDFC0000123',
  };
  const parser = new CsvParser({ fields: IMPORT_COLUMNS });
  const csv = parser.parse([example]);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="worker-import-template.csv"');
  res.send(csv);
};

async function resolveSiteForImportRow(req, siteName, siteCache) {
  const key = siteName.trim().toLowerCase();
  if (siteCache.has(key)) return siteCache.get(key);
  const site = await Site.findOne({
    where: { ...scopeWhere(req, {}, { allowSiteFilter: false }), name: { [Op.like]: siteName.trim() } },
  });
  siteCache.set(key, site || null);
  return site || null;
}

exports.importCsv = async (req, res) => {
  const t = res.locals.t;
  if (!req.file) {
    req.flash('error', t('err_csv_required'));
    return res.redirect('/workers');
  }

  let records;
  try {
    records = parseCsv(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    req.flash('error', t('err_csv_parse'));
    return res.redirect('/workers');
  }

  const siteCache = new Map();
  let successCount = 0;
  const rowErrors = [];

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const rowNum = i + 2; // header is row 1
    const errs = [];

    const site = row.site_name ? await resolveSiteForImportRow(req, row.site_name, siteCache) : null;
    if (!site) errs.push(`${t('val_site_required')} ("${row.site_name || ''}")`);
    if (!row.name) errs.push(t('val_worker_name_required'));
    if (!row.father_name) errs.push(t('val_father_name_required'));
    if (!row.dob || isNaN(Date.parse(row.dob))) errs.push(t('val_dob_required'));
    if (!['Male', 'Female', 'Other'].includes(row.gender)) errs.push(t('val_gender_required'));
    if (!/^\d{12}$/.test(row.aadhaar || '')) errs.push(t('val_aadhaar_format'));
    if (!row.address_aadhaar) errs.push(t('val_aadhaar_address_required'));
    if (!/^\d{10}$/.test(row.mobile || '')) errs.push(t('val_mobile_format'));
    if (!row.marital_status) errs.push(t('val_marital_status_required'));
    if (!WORKER_CATEGORIES.includes(row.category)) errs.push(t('val_category_required'));
    if (!row.zone || !row.zone.trim()) errs.push(t('val_zone_required'));
    if (!row.wage_rate || isNaN(parseFloat(row.wage_rate)) || parseFloat(row.wage_rate) < 0) errs.push(t('val_wage_rate_required'));
    if (!row.doj || isNaN(Date.parse(row.doj))) errs.push(t('val_doj_required'));
    if (row.uan && !/^\d{12}$/.test(row.uan)) errs.push(t('val_uan_format'));
    const esicApplicable = (row.esic_applicable || '').toLowerCase() === 'yes';
    if (esicApplicable && !/^\d{17}$/.test(row.esic_number || '')) errs.push(t('val_esic_format'));

    if (errs.length > 0) {
      rowErrors.push(`${t('workers_import_row_prefix')} ${rowNum}: ${errs.join('; ')}`);
      continue;
    }

    const dbT = await require('../config/db').transaction();
    try {
      const companyId = site.company_id;
      const aadhaarNum = row.aadhaar;
      const worker = await Worker.create({
        company_id: companyId,
        site_id: site.id,
        name: row.name,
        father_name: row.father_name,
        dob: row.dob,
        gender: row.gender,
        aadhaar_encrypted: encrypt(aadhaarNum),
        aadhaar_last4: aadhaarNum.slice(-4),
        address_aadhaar: row.address_aadhaar,
        mobile: row.mobile,
        email: row.email || null,
        marital_status: row.marital_status,
        bank_account_encrypted: row.bank_account ? encrypt(row.bank_account) : null,
        bank_account_last4: row.bank_account ? row.bank_account.slice(-4) : null,
        ifsc_code: row.ifsc_code || null,
        status: 'active',
        created_by: req.session.user.id,
      }, { transaction: dbT });

      await EmploymentDetail.create({
        worker_id: worker.id,
        category: row.category,
        zone: row.zone,
        wage_rate: parseFloat(row.wage_rate),
        doj: row.doj,
        uan_encrypted: row.uan ? encrypt(row.uan) : null,
        uan_last4: row.uan ? row.uan.slice(-4) : null,
        esic_applicable: esicApplicable,
        esic_encrypted: row.esic_number ? encrypt(row.esic_number) : null,
        esic_last4: row.esic_number ? row.esic_number.slice(-4) : null,
        created_by: req.session.user.id,
      }, { transaction: dbT });

      await dbT.commit();
      await runValidation(worker.id, companyId);
      await logAudit(req, { action: 'create', entity: 'Worker', entity_id: worker.id, after_value: { name: worker.name, via: 'csv_import' } });
      successCount++;
    } catch (err) {
      await dbT.rollback();
      console.error(`Import row ${rowNum} error:`, err);
      rowErrors.push(`${t('workers_import_row_prefix')} ${rowNum}: ${err.message}`);
    }
  }

  if (successCount > 0 && rowErrors.length === 0) {
    req.flash('success', t('ok_import_all_success', { count: successCount }));
  } else if (successCount > 0) {
    req.flash('success', t('ok_import_summary', { success: successCount, failed: rowErrors.length }));
    req.flash('error', rowErrors.join(' | '));
  } else {
    req.flash('error', rowErrors.length > 0 ? rowErrors.join(' | ') : t('err_csv_parse'));
  }
  res.redirect('/workers');
};

// ─── Registration Wizard ─────────────────────────────────────────────────────

exports.showRegister = async (req, res) => {
  // Check subscription limit
  if (req.tenantScope.company_id) {
    const sub = await Subscription.findOne({ where: { company_id: req.tenantScope.company_id } });
    if (sub && sub.worker_limit !== null) {
      const count = await Worker.count({ where: { company_id: req.tenantScope.company_id } });
      if (count >= sub.worker_limit) {
        req.flash('error', res.locals.t('err_worker_limit', { limit: sub.worker_limit }));
        return res.redirect('/workers');
      }
    }
  }

  // Draft worker stored in session?
  const draft = req.session.workerDraft || {};

  res.render('workers/wizard/step1', {
    title: 'Register Worker — Step 1',
    draft,
    errors: [],
    step: 1,
  });
};

// Documents a worker must provide before the wizard lets them move past the
// upload step — matches the red-asterisk fields shown in step1.ejs.
const REQUIRED_STEP1_DOCS = {
  aadhaar: 'Aadhaar Card (Front)',
  aadhaar_back: 'Aadhaar Card (Back)',
  passport_photo: 'Passport Photo',
  bank_passbook: 'Bank Passbook',
};

// Runs OCR against whatever was just uploaded (Aadhaar front/back, PAN, bank
// passbook) and merges what it can read into one field set. This is the only
// place OCR runs during onboarding — once, right after upload — so the next
// step (Personal Details) can render already filled in instead of asking the
// worker to retype what's on the document they just handed over.
async function extractOcrFromUploads(uploads) {
  const extracted = {};

  if (uploads.aadhaar && ocrService.isOcrSupported(uploads.aadhaar.mimetype)) {
    try {
      const lines = await ocrService.extractLines(uploads.aadhaar.path, uploads.aadhaar.mimetype);
      Object.assign(extracted, ocrService.parseAadhaarFields(lines));
    } catch (err) {
      console.error('OCR (Aadhaar front) failed:', err.message);
    }
  }

  if (uploads.aadhaar_back && ocrService.isOcrSupported(uploads.aadhaar_back.mimetype)) {
    try {
      const lines = await ocrService.extractLines(uploads.aadhaar_back.path, uploads.aadhaar_back.mimetype);
      const backFields = ocrService.parseAadhaarFields(lines);
      // The back side is the more reliable source for the printed address.
      if (backFields.address) extracted.address = backFields.address;
      if (!extracted.aadhaar && backFields.aadhaar) extracted.aadhaar = backFields.aadhaar;
    } catch (err) {
      console.error('OCR (Aadhaar back) failed:', err.message);
    }
  }

  if (uploads.pan_card && ocrService.isOcrSupported(uploads.pan_card.mimetype)) {
    try {
      const lines = await ocrService.extractLines(uploads.pan_card.path, uploads.pan_card.mimetype);
      const panFields = ocrService.parsePanFields(lines);
      if (panFields.pan_number) extracted.pan_number = panFields.pan_number;
      // Only fall back to the PAN card's name/DOB if the Aadhaar scan didn't
      // already give us one — Aadhaar is the primary identity document here.
      if (!extracted.name && panFields.name) extracted.name = panFields.name;
      if (!extracted.dob && panFields.dob) extracted.dob = panFields.dob;
    } catch (err) {
      console.error('OCR (PAN card) failed:', err.message);
    }
  }

  if (uploads.bank_passbook && ocrService.isOcrSupported(uploads.bank_passbook.mimetype)) {
    try {
      const lines = await ocrService.extractLines(uploads.bank_passbook.path, uploads.bank_passbook.mimetype);
      const bankFields = ocrService.parseBankPassbookFields(lines);
      if (bankFields.bank_account) extracted.bank_account = bankFields.bank_account;
      if (bankFields.ifsc_code) extracted.ifsc_code = bankFields.ifsc_code;
    } catch (err) {
      console.error('OCR (bank passbook) failed:', err.message);
    }
  }

  return extracted;
}

exports.saveStep1 = async (req, res) => {
  try {
    const uploads = {};
    if (req.files) {
      for (const [fieldname, files] of Object.entries(req.files)) {
        if (files.length > 0) {
          uploads[fieldname] = {
            path: files[0].path,
            originalname: files[0].originalname,
            size: files[0].size,
            mimetype: files[0].mimetype,
          };
        }
      }
    }

    if (uploads.passport_photo && uploads.passport_photo.size > 100 * 1024) {
      fs.unlinkSync(uploads.passport_photo.path);
      req.flash('error', res.locals.t('err_photo_size'));
      return res.redirect('/workers/register');
    }

    // Persist whatever was uploaded even if the set is incomplete, so the
    // worker doesn't have to redo files they already provided.
    const mergedUploads = { ...(req.session.workerDraft && req.session.workerDraft._uploads), ...uploads };
    const ocrExtracted = await extractOcrFromUploads(uploads);

    req.session.workerDraft = {
      ...req.session.workerDraft,
      _uploads: mergedUploads,
      _ocrExtracted: { ...(req.session.workerDraft && req.session.workerDraft._ocrExtracted), ...ocrExtracted },
    };

    const missing = Object.keys(REQUIRED_STEP1_DOCS).filter(key => !mergedUploads[key]);
    if (missing.length > 0) {
      req.flash('error', `Please upload: ${missing.map(k => REQUIRED_STEP1_DOCS[k]).join(', ')}.`);
      req.session.save(() => res.redirect('/workers/register'));
      return;
    }

    req.session.workerDraft._step = 1;
    req.session.save(err => {
      if (err) { req.flash('error', res.locals.t('err_session')); return res.redirect('/workers/register'); }
      res.redirect('/workers/register/step2');
    });
  } catch (err) {
    console.error('Step1 save error:', err);
    req.flash('error', res.locals.t('err_save_documents'));
    res.redirect('/workers/register');
  }
};

exports.showStep2 = async (req, res) => {
  if (!req.session.workerDraft || !req.session.workerDraft._step) {
    return res.redirect('/workers/register');
  }
  const sites = await Site.findAll({
    where: scopeWhere(req, { status: 'active' }, { allowSiteFilter: false }),
    attributes: ['id', 'name'],
  });

  // If site_supervisor, pre-select their site
  const defaultSiteId = req.tenantScope.site_id || null;

  res.render('workers/wizard/step2', {
    title: 'Register Worker — Step 2',
    sites,
    draft: req.session.workerDraft,
    defaultSiteId,
    errors: [],
    step: 2,
  });
};

exports.saveStep2 = async (req, res) => {
  try {
    const errors = validationResult(req);
    const sites = await Site.findAll({ where: scopeWhere(req, { status: 'active' }, { allowSiteFilter: false }), attributes: ['id', 'name'] });

    if (!errors.isEmpty()) {
      return res.render('workers/wizard/step2', {
        title: 'Register Worker — Step 2',
        sites,
        draft: { ...req.session.workerDraft, ...req.body },
        defaultSiteId: req.body.site_id,
        errors: errors.array(),
        step: 2,
      });
    }

    if (req.session.user.role === ROLES.SITE_SUPERVISOR) {
      req.body.site_id = req.tenantScope.site_id;
    }

    req.session.workerDraft = { ...req.session.workerDraft, ...req.body, _step: 2 };
    req.session.save(err => {
      if (err) { req.flash('error', res.locals.t('err_session')); return res.redirect('/workers/register/step2'); }
      res.redirect('/workers/register/step3');
    });
  } catch (err) {
    console.error('Step2 save error:', err);
    req.flash('error', res.locals.t('err_save_step1'));
    res.redirect('/workers/register/step2');
  }
};

exports.showStep3 = async (req, res) => {
  if (!req.session.workerDraft || req.session.workerDraft._step < 2) return res.redirect('/workers/register');
  const wageCompanyId = await resolveDraftCompanyId(req);
  const wageMasters = await WageMaster.findAll({
    where: { company_id: wageCompanyId },
    order: [['effective_from', 'DESC']],
  });

  res.render('workers/wizard/step3', {
    title: 'Register Worker — Step 3',
    draft: req.session.workerDraft,
    wageMasters,
    errors: [],
    step: 3,
  });
};

exports.saveStep3 = async (req, res) => {
  try {
    const errors = validationResult(req);
    const wageMasters = await WageMaster.findAll({ where: { company_id: await resolveDraftCompanyId(req) } });

    if (!errors.isEmpty()) {
      return res.render('workers/wizard/step3', {
        title: 'Register Worker — Step 3',
        draft: { ...req.session.workerDraft, ...req.body },
        wageMasters,
        errors: errors.array(),
        step: 3,
      });
    }

    req.session.workerDraft = { ...req.session.workerDraft, ...req.body, _step: 3 };
    req.session.save(err => {
      if (err) { req.flash('error', res.locals.t('err_session')); return res.redirect('/workers/register/step3'); }
      res.redirect('/workers/register/step4');
    });
  } catch (err) {
    console.error('Step3 save error:', err);
    req.flash('error', res.locals.t('err_save_step2'));
    res.redirect('/workers/register/step3');
  }
};

exports.showStep4 = (req, res) => {
  if (!req.session.workerDraft || req.session.workerDraft._step < 3) return res.redirect('/workers/register');
  res.render('workers/wizard/step4', {
    title: 'Register Worker — Step 4',
    draft: req.session.workerDraft,
    errors: [],
    step: 4,
  });
};

exports.saveStep4 = async (req, res) => {
  try {
  const familyUploads = {};
  if (req.files) {
    for (const [fieldname, files] of Object.entries(req.files)) {
      if (files.length > 0) {
        familyUploads[fieldname] = {
          path: files[0].path,
          size: files[0].size,
          mimetype: files[0].mimetype,
        };
      }
    }
  }

  const familyMembers = [];
  const names = [].concat(req.body['family_name[]'] || []);
  const relations = [].concat(req.body['family_relation[]'] || []);
  const aadhaarNums = [].concat(req.body['family_aadhaar[]'] || []);

  for (let i = 0; i < names.length; i++) {
    if (names[i] && names[i].trim()) {
      familyMembers.push({
        name: names[i].trim(),
        relation: relations[i] || 'child',
        aadhaar: aadhaarNums[i] || '',
        photoKey: `family_photo_${i}`,
        photo: familyUploads[`family_photo_${i}`] || null,
      });
    }
  }

  req.session.workerDraft = { ...req.session.workerDraft, _familyMembers: familyMembers, _step: 4 };
  req.session.save(err => {
    if (err) { req.flash('error', res.locals.t('err_session')); return res.redirect('/workers/register/step4'); }
    res.redirect('/workers/register/step5');
  });
  } catch (err) {
    console.error('Step4 save error:', err);
    req.flash('error', res.locals.t('err_save_family'));
    res.redirect('/workers/register/step4');
  }
};

exports.showStep5 = (req, res) => {
  if (!req.session.workerDraft || req.session.workerDraft._step < 4) return res.redirect('/workers/register');
  res.render('workers/wizard/step5', {
    title: 'Register Worker — Step 5 (Review)',
    draft: req.session.workerDraft,
    step: 5,
  });
};

// Re-OCRs the stored Aadhaar / bank passbook upload against what the worker
// typed on earlier steps, so verifiers get an automatic mismatch flag instead
// of having to eyeball scanned documents. Runs before the DB transaction
// since OCR is slow (seconds) and shouldn't hold a transaction open.
async function computeOcrVerification(fieldname, fileInfo, draft) {
  if (!['aadhaar', 'aadhaar_back', 'pan_card', 'bank_passbook'].includes(fieldname)) return null;
  if (!fileInfo || !ocrService.isOcrSupported(fileInfo.mimetype)) return null;

  try {
    const lines = await ocrService.extractLines(fileInfo.path, fileInfo.mimetype);
    if (lines === null) return null;

    if (fieldname === 'aadhaar' || fieldname === 'aadhaar_back') {
      const fields = ocrService.parseAadhaarFields(lines);
      const declaredLast4 = (draft.aadhaar || '').slice(-4);
      const extractedLast4 = fields.aadhaar ? fields.aadhaar.slice(-4) : null;
      // The back side often doesn't repeat the Aadhaar number clearly enough
      // to OCR reliably — only flag a mismatch, never require a match, for it.
      const match = extractedLast4 && declaredLast4 ? extractedLast4 === declaredLast4 : null;
      return { fields, match: fieldname === 'aadhaar_back' && match !== false ? null : match };
    }

    if (fieldname === 'pan_card') {
      const fields = ocrService.parsePanFields(lines);
      const match = fields.pan_number && draft.pan_number
        ? fields.pan_number.toUpperCase() === draft.pan_number.toUpperCase()
        : null;
      return { fields, match };
    }

    const fields = ocrService.parseBankPassbookFields(lines);
    let match = null;
    if (fields.bank_account && draft.bank_account) {
      match = fields.bank_account.slice(-4) === (draft.bank_account || '').slice(-4);
    }
    if (fields.ifsc_code && draft.ifsc_code) {
      const ifscMatch = fields.ifsc_code.toUpperCase() === draft.ifsc_code.toUpperCase();
      match = match === null ? ifscMatch : (match && ifscMatch);
    }
    return { fields, match };
  } catch (err) {
    console.error(`OCR verification failed for ${fieldname}:`, err.message);
    return null;
  }
}

exports.submit = async (req, res) => {
  const draft = req.session.workerDraft;
  if (!draft || draft._step < 4) return res.redirect('/workers/register');

  // OCR-verify uploaded identity documents against typed fields ahead of the
  // transaction (OCR is slow and must not hold a DB transaction open).
  const uploadsForOcr = draft._uploads || {};
  const ocrResults = {};
  for (const [fieldname, fileInfo] of Object.entries(uploadsForOcr)) {
    ocrResults[fieldname] = await computeOcrVerification(fieldname, fileInfo, draft);
  }

  const t = await require('../config/db').transaction();
  try {
    const companyId = await resolveDraftCompanyId(req);
    if (!companyId) {
      throw new Error('Could not determine company for this worker — please select a valid site.');
    }

    // 1. Create Worker
    const aadhaarNum = draft.aadhaar || '';
    const worker = await Worker.create({
      company_id: companyId,
      site_id: draft.site_id,
      name: draft.name,
      father_name: draft.father_name,
      dob: draft.dob,
      gender: draft.gender,
      aadhaar_encrypted: encrypt(aadhaarNum),
      aadhaar_last4: aadhaarNum.slice(-4),
      pan_encrypted: encrypt(draft.pan_number),
      pan_last4: (draft.pan_number || '').slice(-4),
      address_aadhaar: draft.address_aadhaar,
      present_address: draft.present_address,
      mobile: draft.mobile,
      email: draft.email || null,
      marital_status: draft.marital_status,
      bank_account_encrypted: encrypt(draft.bank_account),
      bank_account_last4: (draft.bank_account || '').slice(-4),
      ifsc_code: draft.ifsc_code,
      status: 'active',
      created_by: req.session.user.id,
    }, { transaction: t });

    // 2. Employment Details
    await EmploymentDetail.create({
      worker_id: worker.id,
      category: draft.category,
      zone: draft.zone,
      wage_rate: draft.wage_rate,
      doj: draft.doj,
      uan_encrypted: encrypt(draft.uan),
      uan_last4: (draft.uan || '').slice(-4),
      esic_applicable: draft.esic_applicable === 'yes' || draft.esic_applicable === true,
      esic_encrypted: encrypt(draft.esic_number),
      esic_last4: (draft.esic_number || '').slice(-4),
      created_by: req.session.user.id,
    }, { transaction: t });

    // 3. Documents
    const uploads = draft._uploads || {};
    for (const [fieldname, fileInfo] of Object.entries(uploads)) {
      if (fileInfo) {
        const ocrResult = ocrResults[fieldname];
        await Document.create({
          worker_id: worker.id,
          doc_type: fieldname,
          file_path: fileInfo.path,
          file_size: fileInfo.size,
          mime_type: fileInfo.mimetype,
          original_name: fileInfo.originalname,
          ocr_data: ocrResult ? ocrResult.fields : null,
          ocr_match: ocrResult && ocrResult.match !== null ? (ocrResult.match ? 'match' : 'mismatch') : 'unchecked',
          status: 'pending',
          uploaded_by: req.session.user.id,
          created_by: req.session.user.id,
        }, { transaction: t });
      }
    }

    // 4. Family Members
    const familyMembers = draft._familyMembers || [];
    for (const member of familyMembers) {
      await FamilyMember.create({
        worker_id: worker.id,
        relation: member.relation,
        name: member.name,
        aadhaar_encrypted: encrypt(member.aadhaar),
        aadhaar_last4: (member.aadhaar || '').slice(-4),
        photo_path: member.photo ? member.photo.path : null,
        created_by: req.session.user.id,
      }, { transaction: t });
    }

    await t.commit();

    // 5. Run Validation Engine
    const validationResults = await runValidation(worker.id, companyId);
    const failed = validationResults.filter(r => r.result === 'fail');

    await logAudit(req, { action: 'create', entity: 'Worker', entity_id: worker.id, after_value: { name: worker.name } });

    // Clear draft
    delete req.session.workerDraft;

    req.flash('success', failed.length > 0
      ? res.locals.t('ok_worker_registered_fail', { name: worker.name, count: failed.length })
      : res.locals.t('ok_worker_registered_pass', { name: worker.name }));
    res.redirect(`/workers/${worker.id}`);
  } catch (err) {
    await t.rollback();
    console.error('Worker submission error:', err);
    req.flash('error', res.locals.t('err_save_worker'));
    res.redirect('/workers/register/step5');
  }
};

exports.saveDraft = async (req, res) => {
  req.session.workerDraft = { ...(req.session.workerDraft || {}), ...req.body };
  req.flash('info', res.locals.t('info_draft_saved') || 'Draft saved. You can continue registration any time.');
  res.redirect('/workers');
};

exports.exitRegistration = (req, res) => {
  delete req.session.workerDraft;
  res.redirect('/workers');
};

// ─── Worker Profile ──────────────────────────────────────────────────────────

exports.show = async (req, res) => {
  try {
    const worker = await Worker.findByPk(req.params.id, {
      include: [
        { model: Site, as: 'site' },
        { model: EmploymentDetail, as: 'employment' },
        { model: Document, as: 'documents' },
        { model: FamilyMember, as: 'family_members' },
        { model: ValidationResult, as: 'validation_results', order: [['checked_at', 'DESC']], separate: true, limit: 20 },
      ],
    });
    if (!worker) { req.flash('error', res.locals.t('err_worker_not_found')); return res.redirect('/workers'); }
    assertTenantOwnership(worker, req);

    // Decrypt for display (show only last4 for sensitive fields)
    const displayWorker = worker.toJSON();

    res.render('workers/show', { title: worker.name, worker: displayWorker });
  } catch (err) {
    if (err.status === 403) { req.flash('error', res.locals.t('err_access_denied')); return res.redirect('/workers'); }
    console.error(err);
    req.flash('error', res.locals.t('err_load_worker_profile'));
    res.redirect('/workers');
  }
};

exports.acknowledgeCheck = async (req, res) => {
  try {
    const worker = await Worker.findByPk(req.params.id);
    if (!worker) { req.flash('error', res.locals.t('err_worker_not_found')); return res.redirect('/workers'); }
    assertTenantOwnership(worker, req);

    const { check_name, override_note } = req.body;
    const vr = await ValidationResult.findOne({ where: { worker_id: worker.id, check_name } });
    if (!vr) { req.flash('error', 'Validation check not found.'); return res.redirect(`/workers/${worker.id}`); }

    await vr.update({
      overridden: true,
      override_note: (override_note || '').trim() || 'Acknowledged by HR/Admin.',
      override_by: req.session.user.id,
      override_at: new Date(),
    });

    await logAudit(req, { action: 'update', entity: 'ValidationResult', entity_id: vr.id, after_value: { check_name, overridden: true, note: override_note } });
    req.flash('success', `Check "${check_name.replace(/_/g, ' ')}" acknowledged.`);
    res.redirect(`/workers/${worker.id}`);
  } catch (err) {
    if (err.status === 403) { req.flash('error', res.locals.t('err_access_denied')); return res.redirect('/workers'); }
    console.error(err);
    req.flash('error', 'Failed to acknowledge check.');
    res.redirect(`/workers/${req.params.id}`);
  }
};

exports.destroy = async (req, res) => {
  try {
    const worker = await Worker.findByPk(req.params.id);
    if (!worker) { req.flash('error', res.locals.t('err_worker_not_found')); return res.redirect('/workers'); }
    assertTenantOwnership(worker, req);
    const before = { name: worker.name };
    await worker.update({ status: 'inactive', updated_by: req.session.user.id });
    await logAudit(req, { action: 'delete', entity: 'Worker', entity_id: worker.id, before_value: before });
    req.flash('success', res.locals.t('ok_worker_deactivated', { name: worker.name }));
    res.redirect('/workers');
  } catch (err) {
    console.error(err);
    req.flash('error', res.locals.t('err_deactivate_worker'));
    res.redirect('/workers');
  }
};
