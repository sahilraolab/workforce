const path = require('path');
const ejs = require('ejs');
const { Op } = require('sequelize');
const {
  Worker, EmploymentDetail, Payroll, Company, Site,
  Attendance, LeaveRecord, FamilyMember,
} = require('../models');
const { decrypt } = require('./cryptoService');

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function fmtAmt(n) {
  const num = parseFloat(n) || 0;
  return '₹' + num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function numberToWords(amount) {
  const num = Math.round(parseFloat(amount) || 0);
  if (num === 0) return 'Zero Rupees Only';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function below100(n) { return n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : ''); }
  function below1000(n) { return n < 100 ? below100(n) : ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + below100(n % 100) : ''); }
  let result = '';
  const crore = Math.floor(num / 10000000);
  const lakh = Math.floor((num % 10000000) / 100000);
  const thousand = Math.floor((num % 100000) / 1000);
  const rest = num % 1000;
  if (crore) result += below1000(crore) + ' Crore ';
  if (lakh) result += below100(lakh) + ' Lakh ';
  if (thousand) result += below1000(thousand) + ' Thousand ';
  if (rest) result += below1000(rest);
  return result.trim() + ' Rupees Only';
}

function formConfig(regulatory_regime, jurisdiction) {
  if (regulatory_regime === 'osh_code_2020') return { formNumber: 'FORM XVI', formRule: 'See rule 72(2)', formNote: 'the Occupational Safety, Health and Working Conditions Code, 2020 (Central Rules)' };
  if (jurisdiction === 'gujarat') return { formNumber: 'FORM V', formRule: 'See rule 43', formNote: 'the Code on Wages, 2019 (Gujarat State Rules)' };
  return { formNumber: 'FORM V', formRule: 'See rule 52', formNote: 'the Code on Wages, 2019 (Central Rules)' };
}

function getFormHeader(docType, regulatory_regime, jurisdiction) {
  const r = regulatory_regime || 'code_on_wages_2019';
  const j = jurisdiction || 'central';
  const C = {
    employment_register: {
      code_on_wages_2019: {
        central: { num: 'FORM I', rule: 'See Rule 51(1)(i)', title: 'REGISTER OF EMPLOYEES (KARMCHARI REGISTER)', note: 'Code on Wages, 2019 (Central Rules)' },
        gujarat: { num: 'FORM IV', rule: 'See Rule 40(1)(a)', title: 'REGISTER OF EMPLOYEES', note: 'Code on Wages, 2019 (Gujarat State Rules)' },
      },
      osh_code_2020: {
        central: { num: 'FORM XIII', rule: 'See Rule 58(1)(a)', title: 'REGISTER OF WORKERS', note: 'OSH Code, 2020 (Central Rules)' },
        gujarat:  { num: 'FORM 13', rule: 'See Rule 57(1)(a)', title: 'REGISTER OF WORKERS', note: 'OSH Code, 2020 (Gujarat State Rules)' },
      },
    },
    wage_register: {
      code_on_wages_2019: {
        central: { num: 'FORM IV', rule: 'See Clause (ii) of Sub Rule (1) of Rule 51', title: 'REGISTER OF WAGES, OVERTIME, ADVANCES, FINES AND DEDUCTIONS FOR DAMAGE AND LOSS', note: 'Code on Wages, 2019 (Central Rules)' },
        gujarat: { num: 'REGISTER OF WAGES – I', rule: 'See Rule 40', title: 'REGISTER OF WAGES, OVERTIME, FINE, DEDUCTION FOR DAMAGE & LOSS', note: 'Code on Wages, 2019 (Gujarat State Rules)' },
      },
      osh_code_2020: {
        central: { num: 'FORM XV', rule: 'See Rule 72(1)', title: 'REGISTER OF WAGES, OVERTIME AND DEDUCTIONS', note: 'OSH Code, 2020 (Central Rules)' },
        gujarat:  { num: 'FORM 13', rule: 'See Rule 66(1)', title: 'REGISTER OF WAGES', note: 'OSH Code, 2020 (Gujarat State Rules)' },
      },
    },
    muster_roll: {
      code_on_wages_2019: {
        central: { num: 'FORM 9', rule: 'See Clause (iii) of Sub Rule (1) of Rule 51', title: 'ATTENDANCE REGISTER CUM MUSTER ROLL', note: 'Code on Wages, 2019 (Central Rules)' },
        gujarat: { num: 'FORM 9', rule: 'See Rule 40', title: 'ATTENDANCE REGISTER CUM MUSTER ROLL', note: 'Code on Wages, 2019 (Gujarat State Rules)' },
      },
      osh_code_2020: {
        central: { num: 'FORM XIV', rule: 'See Rule 71(1)', title: 'ATTENDANCE REGISTER CUM MUSTER ROLL', note: 'OSH Code, 2020 (Central Rules)' },
        gujarat:  { num: 'FORM 14', rule: 'See Rule 65(1)', title: 'ATTENDANCE REGISTER CUM MUSTER ROLL', note: 'OSH Code, 2020 (Gujarat State Rules)' },
      },
    },
    leave_register: {
      code_on_wages_2019: {
        central: { num: 'LEAVE REGISTER', rule: 'As per Code on Wages, 2019', title: 'LEAVE WITH WAGES REGISTER', note: 'Code on Wages, 2019 (Central Rules)' },
        gujarat: { num: 'LEAVE REGISTER', rule: 'As per Code on Wages, 2019', title: 'LEAVE WITH WAGES REGISTER', note: 'Code on Wages, 2019 (Gujarat State Rules)' },
      },
      osh_code_2020: {
        central: { num: 'FORM XX', rule: 'See Rule 79(1)', title: 'LEAVE WITH WAGES REGISTER', note: 'OSH Code, 2020 (Central Rules)' },
        gujarat:  { num: 'FORM 19', rule: 'See Rule 73(1)', title: 'LEAVE WITH WAGES REGISTER', note: 'OSH Code, 2020 (Gujarat State Rules)' },
      },
    },
    service_certificate: {
      code_on_wages_2019: {
        central: { num: 'SERVICE CERTIFICATE', rule: 'As per Code on Wages, 2019', title: 'SERVICE CERTIFICATE', note: 'Code on Wages, 2019 (Central Rules)' },
        gujarat: { num: 'SERVICE CERTIFICATE', rule: 'As per Code on Wages, 2019', title: 'SERVICE CERTIFICATE', note: 'Code on Wages, 2019 (Gujarat State Rules)' },
      },
      osh_code_2020: {
        central: { num: 'FORM 16', rule: 'See Rule 76', title: 'SERVICE CERTIFICATE', note: 'OSH Code, 2020 (Central Rules)' },
        gujarat:  { num: 'FORM 16', rule: 'See Rule 70', title: 'SERVICE CERTIFICATE', note: 'OSH Code, 2020 (Gujarat State Rules)' },
      },
    },
    adult_worker_register: {
      code_on_wages_2019: {
        central: { num: 'ADULT WORKER REGISTER', rule: 'As per Code on Wages, 2019', title: 'REGISTER OF ADULT WORKERS', note: 'Code on Wages, 2019 (Central Rules)' },
        gujarat: { num: 'ADULT WORKER REGISTER', rule: 'As per Code on Wages, 2019', title: 'REGISTER OF ADULT WORKERS', note: 'Code on Wages, 2019 (Gujarat State Rules)' },
      },
      osh_code_2020: {
        central: { num: 'FORM XVII', rule: 'See Rule 71(2)', title: 'REGISTER OF ADULT WORKERS', note: 'OSH Code, 2020 (Central Rules)' },
        gujarat:  { num: 'FORM 17', rule: 'See Rule 65(2)', title: 'REGISTER OF ADULT WORKERS', note: 'OSH Code, 2020 (Gujarat State Rules)' },
      },
    },
    leave_card: {
      code_on_wages_2019: {
        central: { num: 'LEAVE CARD', rule: 'As per Code on Wages, 2019', title: 'LEAVE CARD', note: 'Code on Wages, 2019 (Central Rules)' },
        gujarat: { num: 'LEAVE CARD', rule: 'As per Code on Wages, 2019', title: 'LEAVE CARD', note: 'Code on Wages, 2019 (Gujarat State Rules)' },
      },
      osh_code_2020: {
        central: { num: 'FORM XX-A', rule: 'See Rule 79(2)', title: 'LEAVE CARD', note: 'OSH Code, 2020 (Central Rules)' },
        gujarat:  { num: 'FORM 20', rule: 'See Rule 73(2)', title: 'LEAVE CARD', note: 'OSH Code, 2020 (Gujarat State Rules)' },
      },
    },
    annual_return: {
      code_on_wages_2019: {
        central: { num: 'ANNUAL RETURN', rule: 'As per Code on Wages, 2019', title: 'ANNUAL RETURN', note: 'Code on Wages, 2019 (Central Rules)' },
        gujarat: { num: 'ANNUAL RETURN', rule: 'As per Code on Wages, 2019', title: 'ANNUAL RETURN', note: 'Code on Wages, 2019 (Gujarat State Rules)' },
      },
      osh_code_2020: {
        central: { num: 'FORM 23', rule: 'See Rule 37', title: 'UNIFIED ANNUAL RETURN', note: 'OSH Code, 2020 / IR Code, 2020 / Social Security Code, 2020 / Code on Wages, 2019' },
        gujarat:  { num: 'FORM 23', rule: 'See Rule 37', title: 'ANNUAL RETURN', note: 'OSH Code, 2020 (Gujarat State Rules)' },
      },
    },
    half_yearly_return: {
      code_on_wages_2019: {
        central: { num: 'HALF YEARLY RETURN', rule: 'As per Code on Wages, 2019', title: 'HALF YEARLY RETURN', note: 'Code on Wages, 2019 (Central Rules)' },
        gujarat: { num: 'HALF YEARLY RETURN', rule: 'As per Code on Wages, 2019', title: 'HALF YEARLY RETURN', note: 'Code on Wages, 2019 (Gujarat State Rules)' },
      },
      osh_code_2020: {
        central: { num: 'FORM XVIII', rule: 'See Rule 75(1)', title: 'HALF YEARLY RETURN', note: 'OSH Code, 2020 (Central Rules)' },
        gujarat:  { num: 'FORM 18', rule: 'See Rule 69(1)', title: 'HALF YEARLY RETURN', note: 'OSH Code, 2020 (Gujarat State Rules)' },
      },
    },
  };
  const d = C[docType] || {};
  const rc = d[r] || d['osh_code_2020'] || d['code_on_wages_2019'] || {};
  const cfg = rc[j] || rc['central'] || rc['gujarat'];
  return cfg || { num: 'FORM', rule: '', title: docType.replace(/_/g, ' ').toUpperCase(), note: '' };
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function fetchWorkerFull(workerId) {
  const worker = await Worker.findByPk(workerId, {
    include: [
      { model: EmploymentDetail, as: 'employment' },
      { model: Site, as: 'site' },
      { model: FamilyMember, as: 'family_members' },
      { model: Company, as: 'company', attributes: ['id', 'name', 'address', 'regulatory_regime', 'jurisdiction', 'contact_phone', 'contact_email'] },
    ],
  });
  if (!worker) throw Object.assign(new Error('Worker not found'), { status: 404 });
  return worker;
}

async function fetchSiteWorkers(companyId, siteId) {
  const where = { company_id: companyId, status: 'active' };
  if (siteId) where.site_id = siteId;
  return Worker.findAll({
    where,
    include: [
      { model: EmploymentDetail, as: 'employment' },
      { model: Site, as: 'site', attributes: ['id', 'name', 'location'] },
    ],
    order: [['name', 'ASC']],
  });
}

async function fetchCompany(companyId) {
  return Company.findByPk(companyId);
}

function decryptSafe(encrypted) {
  try { return encrypted ? decrypt(encrypted) : null; } catch (_) { return null; }
}

function establishmentBlock(company, site) {
  return {
    name: company.name,
    address: [site && site.location ? `${site.name}, ${site.location}` : site && site.name ? site.name : null, company.address].filter(Boolean).join(' | ') || '—',
  };
}

// ─── 1. Salary Slip ───────────────────────────────────────────────────────────

async function buildSalarySlipData(workerId, month, year) {
  const worker = await fetchWorkerFull(workerId);
  const payrollRow = await Payroll.findOne({ where: { worker_id: workerId, month, year } });
  if (!payrollRow) throw Object.assign(new Error('Payroll not generated for this period'), { status: 404 });
  const company = worker.company;
  const employment = worker.employment;
  const site = worker.site;
  const uan = decryptSafe(employment && employment.uan_encrypted);
  const modeOfPayment = worker.bank_account_encrypted ? 'Bank Transfer (NEFT/IMPS)' : 'Cash';
  const basicWage = parseFloat(payrollRow.basic_wage) || 0;
  const otAmount = parseFloat(payrollRow.ot_amount) || 0;
  const gross = parseFloat(payrollRow.gross) || 0;
  const da = 0;
  const otherAllowances = Math.max(0, gross - basicWage - da - otAmount);
  const pfDeduction = parseFloat(payrollRow.pf_deduction) || 0;
  const esicDeduction = parseFloat(payrollRow.esic_deduction) || 0;
  const otherDeductions = parseFloat(payrollRow.other_deductions) || 0;
  const totalDeductions = pfDeduction + esicDeduction + otherDeductions;
  const netPay = parseFloat(payrollRow.net_pay) || 0;
  const monthName = MONTH_NAMES[month];
  const lastDay = new Date(year, month, 0).getDate();
  const form = formConfig(company.regulatory_regime, company.jurisdiction);
  return {
    ...form, monthName, month, year,
    wagePeriodFrom: `1 ${monthName} ${year}`,
    wagePeriodTo: `${lastDay} ${monthName} ${year}`,
    establishment: establishmentBlock(company, site),
    worker: { id: worker.id, name: worker.name, fatherName: worker.father_name, designation: employment ? employment.category : null, uan, modeOfPayment },
    payroll: { daysPresent: parseFloat(payrollRow.days_present) || 0, daysInMonth: parseInt(payrollRow.days_in_month) || 26, otHours: parseFloat(payrollRow.ot_hours) || 0, basicWage, da, otherAllowances, otAmount, gross, pfDeduction, esicDeduction, otherDeductions, totalDeductions, netPay, netPayWords: numberToWords(netPay), dateOfPayment: null },
    fmtAmt,
  };
}

// ─── 2. Muster Roll ───────────────────────────────────────────────────────────

async function buildMusterRollData(companyId, siteId, month, year) {
  const company = await fetchCompany(companyId);
  const fh = getFormHeader('muster_roll', company.regulatory_regime, company.jurisdiction);
  const site = siteId ? await Site.findByPk(siteId) : null;
  const workers = await fetchSiteWorkers(companyId, siteId);
  const lastDay = new Date(year, month, 0).getDate();
  const days = Array.from({ length: lastDay }, (_, i) => i + 1);

  // Fetch all attendance for this month in one query
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const allAttendance = await Attendance.findAll({
    where: {
      worker_id: { [Op.in]: workers.map(w => w.id) },
      date: { [Op.between]: [startDate, endDate] },
    },
  });

  // Index by worker_id → day
  const attMap = {};
  allAttendance.forEach(a => {
    const day = new Date(a.date).getDate();
    if (!attMap[a.worker_id]) attMap[a.worker_id] = {};
    attMap[a.worker_id][day] = a.status;
  });

  const rows = workers.map((w, idx) => {
    const wAtt = attMap[w.id] || {};
    let present = 0, half = 0, absent = 0;
    const dayStatuses = days.map(d => {
      const s = wAtt[d];
      if (s === 'present') { present++; return 'P'; }
      if (s === 'half_day') { half += 0.5; return 'H'; }
      if (s === 'absent') { absent++; return 'A'; }
      return '—';
    });
    return { sno: idx + 1, id: w.id, name: w.name, category: w.employment ? w.employment.category : '—', dayStatuses, present, half, absent, total: present + half };
  });

  return { fh, company, site, month, year, monthName: MONTH_NAMES[month], days, rows, lastDay, generatedOn: fmtDate(new Date()) };
}

// ─── 3. Wage Register ─────────────────────────────────────────────────────────

async function buildWageRegisterData(companyId, siteId, month, year) {
  const company = await fetchCompany(companyId);
  const fh = getFormHeader('wage_register', company.regulatory_regime, company.jurisdiction);
  const site = siteId ? await Site.findByPk(siteId) : null;
  const workers = await fetchSiteWorkers(companyId, siteId);
  const payrolls = await Payroll.findAll({
    where: { worker_id: { [Op.in]: workers.map(w => w.id) }, month, year },
  });
  const payMap = {};
  payrolls.forEach(p => { payMap[p.worker_id] = p; });

  let totGross = 0, totPF = 0, totESIC = 0, totOther = 0, totNet = 0;
  const rows = workers.map((w, idx) => {
    const p = payMap[w.id];
    if (!p) return { sno: idx + 1, name: w.name, category: w.employment ? w.employment.category : '—', site: w.site ? w.site.name : '—', hasPayroll: false };
    const gross = parseFloat(p.gross) || 0;
    const pf = parseFloat(p.pf_deduction) || 0;
    const esic = parseFloat(p.esic_deduction) || 0;
    const other = parseFloat(p.other_deductions) || 0;
    const net = parseFloat(p.net_pay) || 0;
    totGross += gross; totPF += pf; totESIC += esic; totOther += other; totNet += net;
    return {
      sno: idx + 1, name: w.name, category: w.employment ? w.employment.category : '—',
      site: w.site ? w.site.name : '—', hasPayroll: true,
      daysPresent: parseFloat(p.days_present) || 0,
      basicWage: parseFloat(p.basic_wage) || 0,
      otAmount: parseFloat(p.ot_amount) || 0,
      gross, pf, esic, other, net,
    };
  });

  return { fh, company, site, month, year, monthName: MONTH_NAMES[month], rows, totals: { gross: totGross, pf: totPF, esic: totESIC, other: totOther, net: totNet }, fmtAmt, generatedOn: fmtDate(new Date()) };
}

// ─── 4. Employment Register ───────────────────────────────────────────────────

async function buildEmploymentRegisterData(companyId, siteId) {
  const company = await fetchCompany(companyId);
  const fh = getFormHeader('employment_register', company.regulatory_regime, company.jurisdiction);
  const site = siteId ? await Site.findByPk(siteId) : null;
  const workers = await fetchSiteWorkers(companyId, siteId);
  const rows = workers.map((w, idx) => {
    const emp = w.employment;
    const uan = decryptSafe(emp && emp.uan_encrypted);
    const esic = decryptSafe(emp && emp.esic_encrypted);
    return {
      sno: idx + 1, id: w.id, name: w.name, fatherName: w.father_name || '—',
      gender: w.gender, dob: fmtDate(w.dob),
      address: w.address_aadhaar || w.present_address || '—',
      category: emp ? emp.category : '—', zone: emp ? emp.zone : '—',
      doj: fmtDate(emp && emp.doj), wageRate: emp ? parseFloat(emp.wage_rate).toFixed(2) : '—',
      uan: uan || (emp && emp.uan_last4 ? '••••••••' + emp.uan_last4 : '—'),
      esicNo: esic || (emp && emp.esic_last4 ? '••••••••••••••' + emp.esic_last4 : '—'),
      mobile: w.mobile || '—', aadhaar: w.aadhaar_last4 ? 'XXXX-XXXX-' + w.aadhaar_last4 : '—',
    };
  });
  return { fh, company, site, rows, generatedOn: fmtDate(new Date()) };
}

// ─── 5. Leave Register ────────────────────────────────────────────────────────

async function buildLeaveRegisterData(companyId, siteId, month, year) {
  const company = await fetchCompany(companyId);
  const fh = getFormHeader('leave_register', company.regulatory_regime, company.jurisdiction);
  const site = siteId ? await Site.findByPk(siteId) : null;
  const workers = await fetchSiteWorkers(companyId, siteId);
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`;

  const allLeaves = await LeaveRecord.findAll({
    where: {
      worker_id: { [Op.in]: workers.map(w => w.id) },
      from_date: { [Op.lte]: endDate },
      to_date: { [Op.gte]: startDate },
    },
    order: [['from_date', 'ASC']],
  });

  const leaveMap = {};
  allLeaves.forEach(l => {
    if (!leaveMap[l.worker_id]) leaveMap[l.worker_id] = [];
    leaveMap[l.worker_id].push(l);
  });

  const rows = workers.map((w, idx) => {
    const leaves = leaveMap[w.id] || [];
    const casual = leaves.filter(l => l.leave_type === 'casual' && l.status === 'approved').reduce((s, l) => s + l.days, 0);
    const sick = leaves.filter(l => l.leave_type === 'sick' && l.status === 'approved').reduce((s, l) => s + l.days, 0);
    const earned = leaves.filter(l => l.leave_type === 'earned' && l.status === 'approved').reduce((s, l) => s + l.days, 0);
    return { sno: idx + 1, name: w.name, category: w.employment ? w.employment.category : '—', casual, sick, earned, total: casual + sick + earned, leaves };
  });

  return { fh, company, site, month, year, monthName: MONTH_NAMES[month], rows, generatedOn: fmtDate(new Date()), fmtDate };
}

// ─── 6. Offer Letter ──────────────────────────────────────────────────────────

async function buildOfferLetterData(workerId) {
  const worker = await fetchWorkerFull(workerId);
  if (!worker) throw Object.assign(new Error('Worker not found'), { status: 404 });
  const emp = worker.employment;
  const company = worker.company;
  const site = worker.site;
  return {
    company, site, establishment: establishmentBlock(company, site),
    worker: {
      id: worker.id, name: worker.name, fatherName: worker.father_name,
      address: worker.present_address || worker.address_aadhaar,
      designation: emp ? emp.category : '—',
      doj: fmtDate(emp && emp.doj),
      wageRate: emp ? parseFloat(emp.wage_rate).toFixed(2) : '—',
    },
    issueDate: fmtDate(new Date()),
  };
}

// ─── 7. Service Certificate ───────────────────────────────────────────────────

async function buildServiceCertificateData(workerId) {
  const worker = await fetchWorkerFull(workerId);
  const emp = worker.employment;
  const company = worker.company;
  const site = worker.site;
  const fh = getFormHeader('service_certificate', company.regulatory_regime, company.jurisdiction);
  return {
    fh, company, site, establishment: establishmentBlock(company, site),
    worker: {
      id: worker.id, name: worker.name, fatherName: worker.father_name,
      designation: emp ? emp.category : '—',
      doj: fmtDate(emp && emp.doj),
      wageRate: emp ? parseFloat(emp.wage_rate).toFixed(2) : '—',
    },
    issueDate: fmtDate(new Date()),
  };
}

// ─── 8. EPF Form 2 (Nomination & Declaration) ────────────────────────────────

async function buildEpfForm2Data(workerId) {
  const worker = await fetchWorkerFull(workerId);
  const emp = worker.employment;
  const company = worker.company;
  const site = worker.site;
  const uan = decryptSafe(emp && emp.uan_encrypted) || (emp && emp.uan_last4 ? '••••••••' + emp.uan_last4 : '—');
  const nominees = (worker.family_members || []).map((m, i) => ({
    sno: i + 1, name: m.name, relation: m.relation,
    aadhaar: m.aadhaar_last4 ? 'XXXX-XXXX-' + m.aadhaar_last4 : '—',
  }));
  return {
    company, site, establishment: establishmentBlock(company, site),
    worker: { id: worker.id, name: worker.name, fatherName: worker.father_name, gender: worker.gender, dob: fmtDate(worker.dob), address: worker.address_aadhaar || '—', designation: emp ? emp.category : '—', doj: fmtDate(emp && emp.doj), uan, aadhaar: worker.aadhaar_last4 ? 'XXXX-XXXX-' + worker.aadhaar_last4 : '—' },
    nominees,
    issueDate: fmtDate(new Date()),
  };
}

// ─── 9. ESIC Form 1 (Declaration Form) ───────────────────────────────────────

async function buildEsicForm1Data(workerId) {
  const worker = await fetchWorkerFull(workerId);
  const emp = worker.employment;
  const company = worker.company;
  const site = worker.site;
  const esicNo = decryptSafe(emp && emp.esic_encrypted) || (emp && emp.esic_last4 ? '••••••••••••••' + emp.esic_last4 : '—');
  const family = (worker.family_members || []).map((m, i) => ({ sno: i + 1, name: m.name, relation: m.relation, aadhaar: m.aadhaar_last4 ? 'XXXX-XXXX-' + m.aadhaar_last4 : '—' }));
  return {
    company, site, establishment: establishmentBlock(company, site),
    worker: { id: worker.id, name: worker.name, fatherName: worker.father_name, gender: worker.gender, dob: fmtDate(worker.dob), address: worker.address_aadhaar || '—', mobile: worker.mobile || '—', designation: emp ? emp.category : '—', doj: fmtDate(emp && emp.doj), esicNo, aadhaar: worker.aadhaar_last4 ? 'XXXX-XXXX-' + worker.aadhaar_last4 : '—' },
    family,
    issueDate: fmtDate(new Date()),
  };
}

// ─── 10. Adult Worker Register ────────────────────────────────────────────────

async function buildAdultWorkerRegisterData(companyId, siteId) {
  const company = await fetchCompany(companyId);
  const fh = getFormHeader('adult_worker_register', company.regulatory_regime, company.jurisdiction);
  const site = siteId ? await Site.findByPk(siteId) : null;
  const workers = await fetchSiteWorkers(companyId, siteId);
  const rows = workers.map((w, idx) => {
    const emp = w.employment;
    return {
      sno: idx + 1, id: w.id, name: w.name, fatherName: w.father_name || '—',
      gender: w.gender || '—', dob: fmtDate(w.dob),
      category: emp ? emp.category : '—',
      doj: fmtDate(emp && emp.doj),
      wageRate: emp ? parseFloat(emp.wage_rate).toFixed(2) : '—',
      hoursOfWork: '8', overtime: 'As per rules', restDay: 'Sunday',
      mobile: w.mobile || '—',
      aadhaar: w.aadhaar_last4 ? 'XXXX-XXXX-' + w.aadhaar_last4 : '—',
    };
  });
  return { fh, company, site, rows, generatedOn: fmtDate(new Date()) };
}

// ─── 11. Leave Card (per worker, per year) ────────────────────────────────────

async function buildLeaveCardData(workerId, year) {
  const worker = await fetchWorkerFull(workerId);
  const emp = worker.employment;
  const company = worker.company;
  const site = worker.site;
  const fh = getFormHeader('leave_card', company.regulatory_regime, company.jurisdiction);

  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;
  const allLeaves = await LeaveRecord.findAll({
    where: {
      worker_id: workerId,
      from_date: { [Op.lte]: endDate },
      to_date: { [Op.gte]: startDate },
    },
    order: [['from_date', 'ASC']],
  });

  const monthRows = MONTH_NAMES.slice(1).map((mn, i) => {
    const m = i + 1;
    const mLeaves = allLeaves.filter(l => {
      const lm = new Date(l.from_date).getMonth() + 1;
      return lm === m;
    });
    const el = mLeaves.filter(l => l.leave_type === 'earned'  && l.status === 'approved').reduce((s, l) => s + l.days, 0);
    const cl = mLeaves.filter(l => l.leave_type === 'casual'  && l.status === 'approved').reduce((s, l) => s + l.days, 0);
    const sl = mLeaves.filter(l => l.leave_type === 'sick'    && l.status === 'approved').reduce((s, l) => s + l.days, 0);
    return { month: mn, el, cl, sl, total: el + cl + sl, leaves: mLeaves };
  });

  const totalEl = monthRows.reduce((s, r) => s + r.el, 0);
  const totalCl = monthRows.reduce((s, r) => s + r.cl, 0);
  const totalSl = monthRows.reduce((s, r) => s + r.sl, 0);

  return {
    fh, company, site, year,
    worker: { id: worker.id, name: worker.name, fatherName: worker.father_name, designation: emp ? emp.category : '—', doj: fmtDate(emp && emp.doj) },
    monthRows, totals: { el: totalEl, cl: totalCl, sl: totalSl, all: totalEl + totalCl + totalSl },
    generatedOn: fmtDate(new Date()), fmtDate,
  };
}

// ─── 12. Annual Return ────────────────────────────────────────────────────────

async function buildAnnualReturnData(companyId, year) {
  const company = await fetchCompany(companyId);
  const fh = getFormHeader('annual_return', company.regulatory_regime, company.jurisdiction);

  const allWorkers = await Worker.findAll({
    where: { company_id: companyId },
    include: [{ model: EmploymentDetail, as: 'employment' }],
    attributes: ['id', 'gender', 'status'],
  });

  const active = allWorkers.filter(w => w.status === 'active');
  const countBy = (arr, gend) => arr.filter(w => (w.gender || '').toLowerCase() === gend).length;

  const stats = {
    maxWorkers: active.length,
    avgWorkers: active.length,
    male: countBy(active, 'male'),
    female: countBy(active, 'female'),
    other: active.length - countBy(active, 'male') - countBy(active, 'female'),
  };

  return { fh, company, year, stats, generatedOn: fmtDate(new Date()) };
}

// ─── 13. Half Yearly Return ───────────────────────────────────────────────────

async function buildHalfYearlyReturnData(companyId, half, year) {
  const company = await fetchCompany(companyId);
  const fh = getFormHeader('half_yearly_return', company.regulatory_regime, company.jurisdiction);

  const fromMonth = half === 1 ? 1 : 7;
  const toMonth   = half === 1 ? 6 : 12;
  const fromLabel = `${MONTH_NAMES[fromMonth]} ${year}`;
  const toLabel   = `${MONTH_NAMES[toMonth]} ${year}`;

  const active = await Worker.findAll({
    where: { company_id: companyId, status: 'active' },
    include: [{ model: EmploymentDetail, as: 'employment' }],
    attributes: ['id', 'name', 'gender'],
  });

  const countBy = (arr, gend) => arr.filter(w => (w.gender || '').toLowerCase() === gend).length;

  const stats = {
    totalWorkers: active.length,
    male: countBy(active, 'male'),
    female: countBy(active, 'female'),
    other: active.length - countBy(active, 'male') - countBy(active, 'female'),
  };

  const startDate = `${year}-${String(fromMonth).padStart(2, '0')}-01`;
  const lastDay   = new Date(year, toMonth, 0).getDate();
  const endDate   = `${year}-${String(toMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const leaves = await LeaveRecord.findAll({
    where: {
      worker_id: { [Op.in]: active.map(w => w.id) },
      status: 'approved',
      from_date: { [Op.lte]: endDate },
      to_date:   { [Op.gte]: startDate },
    },
  });

  const leaveStats = {
    earned: leaves.filter(l => l.leave_type === 'earned').reduce((s, l) => s + l.days, 0),
    casual: leaves.filter(l => l.leave_type === 'casual').reduce((s, l) => s + l.days, 0),
    sick:   leaves.filter(l => l.leave_type === 'sick').reduce((s, l) => s + l.days, 0),
  };
  leaveStats.total = leaveStats.earned + leaveStats.casual + leaveStats.sick;

  return { fh, company, year, half, fromLabel, toLabel, stats, leaveStats, generatedOn: fmtDate(new Date()) };
}

// ─── Render helpers ───────────────────────────────────────────────────────────

async function render(template, data) {
  const templatePath = path.join(__dirname, '../views/document-templates/', template);
  const html = await ejs.renderFile(templatePath, data);
  return html;
}

async function renderSalarySlipHtml(workerId, month, year) {
  const data = await buildSalarySlipData(workerId, month, year);
  return { html: await render('salary-slip.ejs', data), data };
}

async function renderMusterRoll(companyId, siteId, month, year) {
  const data = await buildMusterRollData(companyId, siteId, month, year);
  return render('muster-roll.ejs', data);
}

async function renderWageRegister(companyId, siteId, month, year) {
  const data = await buildWageRegisterData(companyId, siteId, month, year);
  return render('wage-register.ejs', data);
}

async function renderEmploymentRegister(companyId, siteId) {
  const data = await buildEmploymentRegisterData(companyId, siteId);
  return render('employment-register.ejs', data);
}

async function renderLeaveRegister(companyId, siteId, month, year) {
  const data = await buildLeaveRegisterData(companyId, siteId, month, year);
  return render('leave-register.ejs', data);
}

async function renderOfferLetter(workerId) {
  const data = await buildOfferLetterData(workerId);
  return render('offer-letter.ejs', data);
}

async function renderServiceCertificate(workerId) {
  const data = await buildServiceCertificateData(workerId);
  return render('service-certificate.ejs', data);
}

async function renderEpfForm2(workerId) {
  const data = await buildEpfForm2Data(workerId);
  return render('epf-form2.ejs', data);
}

async function renderEsicForm1(workerId) {
  const data = await buildEsicForm1Data(workerId);
  return render('esic-form1.ejs', data);
}

async function renderAdultWorkerRegister(companyId, siteId) {
  const data = await buildAdultWorkerRegisterData(companyId, siteId);
  return render('adult-worker-register.ejs', data);
}

async function renderLeaveCard(workerId, year) {
  const data = await buildLeaveCardData(workerId, year);
  return render('leave-card.ejs', data);
}

async function renderAnnualReturn(companyId, year) {
  const data = await buildAnnualReturnData(companyId, year);
  return render('annual-return.ejs', data);
}

async function renderHalfYearlyReturn(companyId, half, year) {
  const data = await buildHalfYearlyReturnData(companyId, half, year);
  return render('half-yearly-return.ejs', data);
}

module.exports = {
  renderSalarySlipHtml, renderMusterRoll, renderWageRegister,
  renderEmploymentRegister, renderLeaveRegister, renderOfferLetter,
  renderServiceCertificate, renderEpfForm2, renderEsicForm1,
  renderAdultWorkerRegister, renderLeaveCard, renderAnnualReturn, renderHalfYearlyReturn,
  buildSalarySlipData, fmtAmt, fmtDate, MONTH_NAMES,
};
