const { Worker, EmploymentDetail, Document, FamilyMember, IfscMaster, WageMaster, ValidationResult } = require('../models');
const { decrypt } = require('./cryptoService');
const { Op } = require('sequelize');

// ─── Verhoeff Algorithm for Aadhaar checksum ────────────────────────────────
const VERHOEFF_D = [
  [0,1,2,3,4,5,6,7,8,9],
  [1,2,3,4,0,6,7,8,9,5],
  [2,3,4,0,1,7,8,9,5,6],
  [3,4,0,1,2,8,9,5,6,7],
  [4,0,1,2,3,9,5,6,7,8],
  [5,9,8,7,6,0,4,3,2,1],
  [6,5,9,8,7,1,0,4,3,2],
  [7,6,5,9,8,2,1,0,4,3],
  [8,7,6,5,9,3,2,1,0,4],
  [9,8,7,6,5,4,3,2,1,0],
];
const VERHOEFF_P = [
  [0,1,2,3,4,5,6,7,8,9],
  [1,5,7,6,2,8,3,0,9,4],
  [5,8,0,3,7,9,6,1,4,2],
  [8,9,1,6,0,4,3,5,2,7],
  [9,4,5,3,1,2,6,8,7,0],
  [4,2,8,6,5,7,3,9,0,1],
  [2,7,9,3,8,0,6,4,1,5],
  [7,0,4,6,9,1,3,2,5,8],
];
const VERHOEFF_INV = [0,4,3,2,1,9,8,7,6,5];

function verhoeffChecksum(num) {
  let c = 0;
  const digits = String(num).split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][digits[i]]];
  }
  return c === 0;
}

// ─── Individual checks ───────────────────────────────────────────────────────

function checkAadhaarFormat(aadhaar) {
  if (!aadhaar) return { result: 'fail', details: 'Aadhaar number is missing.' };
  if (!/^\d{12}$/.test(aadhaar)) return { result: 'fail', details: 'Aadhaar must be exactly 12 numeric digits.' };
  return { result: 'pass', details: 'Format OK.' };
}

function checkAadhaarChecksum(aadhaar) {
  if (!aadhaar || !/^\d{12}$/.test(aadhaar)) return { result: 'na', details: 'Format check failed — skipping checksum.' };
  const valid = verhoeffChecksum(aadhaar);
  return valid
    ? { result: 'pass', details: 'Verhoeff checksum valid.' }
    : { result: 'fail', details: 'Aadhaar checksum (Verhoeff) failed. Please verify the number.' };
}

function checkAge(dob, doj) {
  if (!dob || !doj) return { result: 'fail', details: 'DOB or DOJ missing.' };
  const birth = new Date(dob);
  const join = new Date(doj);
  // Exact 18th birthday = same calendar date 18 years later
  const eighteenth = new Date(birth.getFullYear() + 18, birth.getMonth(), birth.getDate());
  if (join < eighteenth) {
    const approxAge = (join - birth) / (365.25 * 24 * 60 * 60 * 1000);
    return { result: 'fail', details: `Worker was ${approxAge.toFixed(1)} years old at joining — must be at least 18.` };
  }
  const approxAge = (join - birth) / (365.25 * 24 * 60 * 60 * 1000);
  return { result: 'pass', details: `Age at joining: ${approxAge.toFixed(1)} years.` };
}

function checkUanFormat(uan) {
  if (!uan) return { result: 'na', details: 'UAN not provided.' };
  if (!/^\d{12}$/.test(uan)) return { result: 'fail', details: 'UAN must be exactly 12 numeric digits.' };
  return { result: 'pass', details: 'Format OK.' };
}

function checkEsicFormat(esicNumber, esicApplicable) {
  if (!esicApplicable) return { result: 'na', details: 'ESIC not applicable.' };
  if (!esicNumber) return { result: 'fail', details: 'ESIC number required but missing.' };
  if (!/^\d{17}$/.test(esicNumber)) return { result: 'fail', details: 'ESIC number must be exactly 17 digits.' };
  return { result: 'pass', details: 'Format OK.' };
}

function checkBankFormat(accountNumber, ifsc) {
  const acctOk = accountNumber && /^\d{9,18}$/.test(accountNumber);
  const ifscOk = ifsc && /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc);
  if (!acctOk && !ifscOk) return { result: 'na', details: 'No bank details provided.' };
  if (!acctOk) return { result: 'fail', details: 'Account number must be 9–18 digits.' };
  if (!ifscOk) return { result: 'fail', details: 'IFSC format invalid (expected XXXX0XXXXXX).' };
  return { result: 'pass', details: 'Account and IFSC format OK.' };
}

// ─── Async checks ────────────────────────────────────────────────────────────

async function checkDuplicate(aadhaar, mobile, currentWorkerId, companyId) {
  const aadhaarLast4 = aadhaar ? aadhaar.slice(-4) : null;
  const conditions = [];
  if (aadhaarLast4) conditions.push({ aadhaar_last4: aadhaarLast4, company_id: companyId });
  if (mobile) conditions.push({ mobile, company_id: companyId });

  if (conditions.length === 0) return { result: 'na', details: 'No uniqueness check possible.' };

  const existing = await Worker.findAll({
    where: { [Op.or]: conditions, id: { [Op.ne]: currentWorkerId } },
    attributes: ['id', 'name', 'mobile', 'aadhaar_last4'],
  });

  if (existing.length > 0) {
    return {
      result: 'fail',
      details: `Potential duplicate found: ${existing.map(w => `${w.name} (ID:${w.id})`).join(', ')}`,
    };
  }
  return { result: 'pass', details: 'No duplicate found in the company.' };
}

async function checkIfsc(ifsc) {
  if (!ifsc) return { result: 'na', details: 'No IFSC provided.' };
  const record = await IfscMaster.findByPk(ifsc.toUpperCase());
  if (!record) return { result: 'fail', details: `IFSC "${ifsc}" not found in master list.` };
  return { result: 'pass', details: `IFSC verified: ${record.bank_name}, ${record.branch}.` };
}

async function checkDocumentCompleteness(workerId, esicApplicable) {
  const docs = await Document.findAll({ where: { worker_id: workerId } });
  const byType = {};
  docs.forEach(d => { byType[d.doc_type] = d.status; });

  const mandatory = ['aadhaar', 'passport_photo', 'bank_passbook'];
  if (esicApplicable) mandatory.push('esic_card');

  const missing = mandatory.filter(t => !byType[t]);
  const notVerified = mandatory.filter(t => byType[t] && byType[t] !== 'verified');

  if (missing.length > 0) {
    return { result: 'fail', details: `Missing documents: ${missing.join(', ')}.` };
  }
  if (notVerified.length > 0) {
    return { result: 'fail', details: `Not yet verified: ${notVerified.join(', ')}.` };
  }
  return { result: 'pass', details: 'All mandatory documents uploaded and verified.' };
}

async function checkWageCompliance(workerId, companyId) {
  const emp = await EmploymentDetail.findOne({ where: { worker_id: workerId } });
  if (!emp) return { result: 'na', details: 'No employment record.' };

  const wm = await WageMaster.findOne({
    where: { company_id: companyId, category: emp.category, zone: emp.zone },
    order: [['effective_from', 'DESC']],
  });

  if (!wm) return { result: 'na', details: `No wage master entry for ${emp.category} / ${emp.zone}.` };

  if (parseFloat(emp.wage_rate) < parseFloat(wm.wage_rate)) {
    return {
      result: 'fail',
      details: `Wage ₹${emp.wage_rate}/day is below minimum ₹${wm.wage_rate}/day for ${emp.category} / ${emp.zone}.`,
    };
  }
  return { result: 'pass', details: `Wage ₹${emp.wage_rate}/day meets minimum ₹${wm.wage_rate}/day.` };
}

// ─── Main runner ─────────────────────────────────────────────────────────────

async function runValidation(workerId, companyId) {
  const worker = await Worker.findByPk(workerId, {
    include: [{ model: EmploymentDetail, as: 'employment' }],
  });
  if (!worker) throw new Error(`Worker ${workerId} not found`);

  const aadhaar = worker.aadhaar_encrypted ? tryDecrypt(worker.aadhaar_encrypted) : null;
  const emp = worker.employment;
  const uan = emp && emp.uan_encrypted ? tryDecrypt(emp.uan_encrypted) : null;
  const esicNum = emp && emp.esic_encrypted ? tryDecrypt(emp.esic_encrypted) : null;
  const esicApplicable = emp && emp.esic_applicable;
  const bankAccount = worker.bank_account_encrypted ? tryDecrypt(worker.bank_account_encrypted) : null;

  const checks = [
    { name: 'aadhaar_format',    ...checkAadhaarFormat(aadhaar) },
    { name: 'aadhaar_checksum',  ...checkAadhaarChecksum(aadhaar) },
    { name: 'age_verification',  ...checkAge(worker.dob, emp && emp.doj) },
    { name: 'uan_format',        ...checkUanFormat(uan) },
    { name: 'esic_format',       ...checkEsicFormat(esicNum, esicApplicable) },
    { name: 'bank_format',       ...checkBankFormat(bankAccount, worker.ifsc_code) },
    { name: 'duplicate_check',   ...(await checkDuplicate(aadhaar, worker.mobile, workerId, companyId)) },
    { name: 'ifsc_master',       ...(await checkIfsc(worker.ifsc_code)) },
    { name: 'document_completeness', ...(await checkDocumentCompleteness(workerId, esicApplicable)) },
    { name: 'wage_compliance',   ...(await checkWageCompliance(workerId, companyId)) },
  ];

  // Persist results (replace previous run)
  await ValidationResult.destroy({ where: { worker_id: workerId } });
  await ValidationResult.bulkCreate(
    checks.map(c => ({
      worker_id: workerId,
      check_name: c.name,
      result: c.result,
      details: c.details,
      checked_at: new Date(),
    }))
  );

  return checks;
}

function tryDecrypt(encrypted) {
  try { return decrypt(encrypted); } catch { return null; }
}

module.exports = {
  runValidation,
  // Exported individually for unit testing
  checkAadhaarFormat,
  checkAadhaarChecksum,
  checkAge,
  checkUanFormat,
  checkEsicFormat,
  checkBankFormat,
  verhoeffChecksum,
};
