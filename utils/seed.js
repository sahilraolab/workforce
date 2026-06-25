/**
 * Database seed script.
 * Run: npm run seed   (or: node utils/seed.js)
 *
 * Creates the Super Admin user, a demo company with all 5 roles, two sites,
 * a wage master, an IFSC master, ~18 workers spread across categories/zones
 * (including a couple of draft/invalid ones for testing validation failures),
 * employment details, documents, family members, a month of attendance,
 * validation results, and payroll for the current + previous month — enough
 * to exercise every page in the app with real data.
 *
 * Safe to re-run: company/site/user/wage-master/worker/document data is only
 * created once (findOrCreate / existence checks). Attendance is seeded once
 * per month if empty. Validation results and payroll are recalculated every
 * run since they're cheap and idempotent (upsert / replace).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { encrypt } = require('../services/cryptoService');
const { runValidation } = require('../services/validationEngine');
const { generateMonthlyPayroll } = require('../services/payrollService');
const {
  sequelize, User, Company, Subscription, WageMaster, Site,
  Worker, EmploymentDetail, Document, FamilyMember, Attendance, IfscMaster,
} = require('../models');

// A real (tiny, valid) 1x1 JPEG — written to disk for every seeded document
// so "view document" actually opens a file instead of 404ing. Document rows
// pointing at paths that don't exist on disk is a real, easy-to-reintroduce
// bug: don't just create the DB row, create the file it points at too.
const PLACEHOLDER_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
  'base64'
);
function writeSeedFile(relPath) {
  const full = path.join(__dirname, '..', relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, PLACEHOLDER_JPEG);
}

// ─── Verhoeff checksum generator (for realistic, checksum-valid Aadhaar numbers) ──
const D = [
  [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],
  [3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],
  [6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],
  [9,8,7,6,5,4,3,2,1,0],
];
const P = [
  [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],
  [8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],
  [2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8],
];
const INV = [0,4,3,2,1,9,8,7,6,5];

function generateValidAadhaar() {
  const digits = Array.from({ length: 11 }, () => Math.floor(Math.random() * 10));
  let c = 0;
  const reversed = digits.slice().reverse();
  reversed.forEach((d, i) => { c = D[c][P[(i + 1) % 8][d]]; });
  return digits.join('') + INV[c];
}

// ─── Helpers ────────────────────────────────────────────────────────────────
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[rand(0, arr.length - 1)];
// Local-date formatting — NOT toISOString(), which converts to UTC and
// shifts the date backward by a day in any positive-UTC-offset timezone
// (e.g. IST), silently dropping "today" from date ranges.
const dateOnly = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const FIRST_NAMES_M = ['Ramesh','Suresh','Mahesh','Vikram','Rajesh','Amit','Arjun','Manoj','Deepak','Sanjay','Naveen','Ravi','Ashok','Vijay'];
const FIRST_NAMES_F = ['Anita','Pooja','Sunita','Geeta','Kavita','Sangeeta','Lakshmi','Rekha','Priya','Meena'];
const LAST_NAMES = ['Kumar','Yadav','Singh','Sharma','Patel','Gupta','Verma','Joshi','Mehta','Nair','Tiwari','Chauhan','Reddy','Pal','Mishra','Saxena'];

async function seed() {
  await sequelize.sync({ alter: true });
  console.log('Database synced.');

  // ─── Super Admin ────────────────────────────────────────────────────────
  const superEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@example.com';
  const superPass = process.env.SUPER_ADMIN_PASSWORD || 'ChangeMe123!';

  const [superAdmin, superCreated] = await User.findOrCreate({
    where: { email: superEmail },
    defaults: {
      name: 'Super Admin', email: superEmail,
      password_hash: await bcrypt.hash(superPass, 12),
      role: 'super_admin', status: 'active',
    },
  });
  console.log(superCreated ? `Super Admin created: ${superEmail} / ${superPass}` : `Super Admin already exists: ${superEmail}`);

  if (process.env.NODE_ENV !== 'development') {
    await sequelize.close();
    console.log('Seed complete (production mode — demo data skipped).');
    return;
  }

  // ─── Demo company ───────────────────────────────────────────────────────
  let [company] = await Company.findOrCreate({
    where: { name: 'Demo Construction Co.' },
    defaults: {
      name: 'Demo Construction Co.', status: 'active', plan: 'growth',
      contact_email: 'demo@example.com', created_by: superAdmin.id,
    },
  });

  await Subscription.findOrCreate({
    where: { company_id: company.id },
    defaults: {
      company_id: company.id, plan: 'growth', status: 'active', worker_limit: 500,
      start_date: new Date(), end_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      created_by: superAdmin.id,
    },
  });

  // ─── Sites ──────────────────────────────────────────────────────────────
  const [mainSite] = await Site.findOrCreate({
    where: { company_id: company.id, name: 'Main Site' },
    defaults: { company_id: company.id, name: 'Main Site', location: 'Mumbai, Maharashtra', status: 'active', created_by: superAdmin.id },
  });
  const [siteB] = await Site.findOrCreate({
    where: { company_id: company.id, name: 'Site B — Andheri' },
    defaults: { company_id: company.id, name: 'Site B — Andheri', location: 'Andheri East, Mumbai', status: 'active', created_by: superAdmin.id },
  });

  // ─── Demo users (all 5 roles, password Admin@1234) ─────────────────────
  const hash = await bcrypt.hash('Admin@1234', 12);
  const demoUsers = [
    { email: 'companyadmin@example.com', name: 'Company Admin',      role: 'company_admin',   site_id: null },
    { email: 'supervisor@example.com',   name: 'Site Supervisor',    role: 'site_supervisor', site_id: mainSite.id },
    { email: 'hrpayroll@example.com',    name: 'HR Payroll Officer', role: 'hr_payroll',      site_id: null },
    { email: 'auditor@example.com',      name: 'Auditor',            role: 'auditor',         site_id: null },
  ];
  for (const u of demoUsers) {
    const [user, created] = await User.findOrCreate({
      where: { email: u.email },
      defaults: { company_id: company.id, site_id: u.site_id, name: u.name, email: u.email, password_hash: hash, role: u.role, status: 'active', created_by: superAdmin.id },
    });
    if (!created) await user.update({ password_hash: hash, status: 'active' });
  }
  await User.update({ password_hash: hash }, { where: { email: superEmail } });

  const companyAdmin = await User.findOne({ where: { email: 'companyadmin@example.com' } });
  const supervisor = await User.findOne({ where: { email: 'supervisor@example.com' } });
  await mainSite.update({ supervisor_user_id: supervisor.id });

  // ─── Wage master ────────────────────────────────────────────────────────
  const wageData = [
    { category: 'Unskilled',    zone: 'Zone 1', wage_rate: 500.00 },
    { category: 'Unskilled',    zone: 'Zone 2', wage_rate: 550.00 },
    { category: 'Semi-Skilled', zone: 'Zone 1', wage_rate: 650.00 },
    { category: 'Semi-Skilled', zone: 'Zone 2', wage_rate: 700.00 },
    { category: 'Skilled',      zone: 'Zone 1', wage_rate: 800.00 },
    { category: 'Skilled',      zone: 'Zone 2', wage_rate: 880.00 },
    { category: 'Executive',    zone: 'Zone 1', wage_rate: 1200.00 },
    { category: 'Manager',      zone: 'Zone 1', wage_rate: 1800.00 },
  ];
  for (const w of wageData) {
    await WageMaster.findOrCreate({
      where: { company_id: company.id, category: w.category, zone: w.zone, effective_from: '2024-01-01' },
      defaults: { ...w, company_id: company.id, effective_from: '2024-01-01', created_by: superAdmin.id },
    });
  }

  // ─── IFSC master (so bank-detail validation has real codes to check against) ──
  const ifscData = [
    { ifsc_code: 'HDFC0000123', bank_name: 'HDFC Bank',          branch: 'Andheri',  city: 'Mumbai', state: 'Maharashtra' },
    { ifsc_code: 'SBIN0001234', bank_name: 'State Bank of India', branch: 'Fort',     city: 'Mumbai', state: 'Maharashtra' },
    { ifsc_code: 'ICIC0000567', bank_name: 'ICICI Bank',          branch: 'Bandra',   city: 'Mumbai', state: 'Maharashtra' },
    { ifsc_code: 'PUNB0098765', bank_name: 'Punjab National Bank', branch: 'Dadar',   city: 'Mumbai', state: 'Maharashtra' },
    { ifsc_code: 'AXIS0001122', bank_name: 'Axis Bank',           branch: 'Andheri',  city: 'Mumbai', state: 'Maharashtra' },
  ];
  for (const i of ifscData) {
    await IfscMaster.findOrCreate({ where: { ifsc_code: i.ifsc_code }, defaults: i });
  }
  const validIfscCodes = ifscData.map(i => i.ifsc_code);

  // ─── Workers (only if none seeded yet for this company) ─────────────────
  const existingWorkerCount = await Worker.count({ where: { company_id: company.id } });

  if (existingWorkerCount === 0) {
    console.log('Seeding workers, employment, documents, family members...');

    const sites = [mainSite, siteB];
    const categories = ['Unskilled', 'Semi-Skilled', 'Skilled', 'Executive', 'Manager'];
    const zones = ['Zone 1', 'Zone 2'];
    const usedMobiles = new Set();

    const workerPlans = [];
    for (let i = 0; i < 16; i++) {
      const isFemale = i % 4 === 1;
      const firstName = pick(isFemale ? FIRST_NAMES_F : FIRST_NAMES_M);
      const lastName = pick(LAST_NAMES);
      const category = i < 6 ? 'Unskilled' : i < 10 ? 'Semi-Skilled' : i < 13 ? 'Skilled' : i < 15 ? 'Executive' : 'Manager';
      const zone = pick(zones);
      const wm = wageData.find(w => w.category === category && w.zone === zone) || wageData.find(w => w.category === category);
      workerPlans.push({
        name: `${firstName} ${lastName}`,
        gender: isFemale ? 'Female' : 'Male',
        site: sites[i % 2],
        category,
        zone: wm.zone,
        wageRate: wm.wage_rate,
        belowMinWage: i === 13, // one deliberate wage-compliance failure
        invalidAadhaar: i === 14 || i === 15, // two deliberate checksum failures
        draft: i === 15, // last one stays in draft status
        hasUan: i % 3 !== 0,
        esicApplicable: i % 5 === 0,
        missingDocs: i === 2 || i === 9, // a couple incomplete for the compliance/pending-docs view
      });
    }

    let mobileSeq = 9000000001;
    for (const plan of workerPlans) {
      let mobile = String(mobileSeq++);
      while (usedMobiles.has(mobile)) mobile = String(mobileSeq++);
      usedMobiles.add(mobile);

      const aadhaar = plan.invalidAadhaar
        ? String(rand(100000000000, 999999999999))
        : generateValidAadhaar();

      const birthYear = rand(1975, 2002);
      const dob = `${birthYear}-${String(rand(1, 12)).padStart(2, '0')}-${String(rand(1, 28)).padStart(2, '0')}`;
      const doj = dateOnly(new Date(Date.now() - rand(30, 900) * 24 * 60 * 60 * 1000));
      const bankAccount = String(rand(100000000000, 999999999999));
      const ifsc = pick(validIfscCodes);
      const uan = plan.hasUan ? String(rand(100000000000, 999999999999)) : null;
      const esicNumber = plan.esicApplicable ? String(rand(10000000000000000, 99999999999999999)) : null;

      const worker = await Worker.create({
        company_id: company.id,
        site_id: plan.site.id,
        name: plan.name,
        father_name: `${pick(FIRST_NAMES_M)} ${pick(LAST_NAMES)}`,
        dob,
        gender: plan.gender,
        aadhaar_encrypted: encrypt(aadhaar),
        aadhaar_last4: aadhaar.slice(-4),
        address_aadhaar: `${rand(1, 999)}, ${pick(['Gandhi Nagar','Shivaji Road','MG Road','Station Road','Market Yard'])}, Mumbai, Maharashtra`,
        present_address: null,
        mobile,
        email: null,
        marital_status: pick(['Single', 'Married', 'Widowed', 'Divorced']),
        status: plan.draft ? 'draft' : 'active',
        bank_account_encrypted: encrypt(bankAccount),
        bank_account_last4: bankAccount.slice(-4),
        ifsc_code: ifsc,
        created_by: companyAdmin.id,
      });

      if (!plan.draft) {
        await EmploymentDetail.create({
          worker_id: worker.id,
          category: plan.category,
          zone: plan.zone,
          wage_rate: plan.belowMinWage ? Math.round(plan.wageRate * 0.8) : plan.wageRate,
          doj,
          uan_encrypted: uan ? encrypt(uan) : null,
          uan_last4: uan ? uan.slice(-4) : null,
          esic_applicable: plan.esicApplicable,
          esic_encrypted: esicNumber ? encrypt(esicNumber) : null,
          esic_last4: esicNumber ? esicNumber.slice(-4) : null,
          created_by: companyAdmin.id,
        });

        const docTypes = ['aadhaar', 'passport_photo', 'bank_passbook'];
        if (plan.esicApplicable) docTypes.push('esic_card');
        if (uan) docTypes.push('uan_card');

        const docsToCreate = plan.missingDocs ? docTypes.slice(0, 1) : docTypes;
        for (const docType of docsToCreate) {
          const verified = !plan.missingDocs && Math.random() > 0.15;
          const filePath = `uploads/seed/${worker.id}-${docType}.jpg`;
          writeSeedFile(filePath);
          await Document.create({
            worker_id: worker.id,
            doc_type: docType,
            file_path: filePath,
            file_size: rand(50, 400) * 1024,
            mime_type: 'image/jpeg',
            original_name: `${docType}.jpg`,
            status: verified ? 'verified' : 'pending',
            uploaded_by: companyAdmin.id,
            verified_by: verified ? companyAdmin.id : null,
            verified_at: verified ? new Date() : null,
            created_by: companyAdmin.id,
          });
        }

        if (Math.random() > 0.5) {
          await FamilyMember.create({
            worker_id: worker.id,
            relation: 'spouse',
            name: `${pick(plan.gender === 'Male' ? FIRST_NAMES_F : FIRST_NAMES_M)} ${plan.name.split(' ')[1]}`,
            aadhaar_encrypted: encrypt(generateValidAadhaar()),
            aadhaar_last4: null,
            created_by: companyAdmin.id,
          });
        }
      }
    }
    console.log(`${workerPlans.length} workers seeded (${workerPlans.filter(p => p.draft).length} draft).`);
  } else {
    console.log(`Workers already seeded for this company (${existingWorkerCount}) — skipping worker creation.`);
  }

  // ─── Attendance (seed current month once if empty) ──────────────────────
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const activeWorkers = await Worker.findAll({ where: { company_id: company.id, status: 'active' } });

  const attendanceCount = await Attendance.count({
    where: { worker_id: activeWorkers.map(w => w.id), date: { [require('sequelize').Op.gte]: dateOnly(monthStart) } },
  });

  if (attendanceCount === 0 && activeWorkers.length > 0) {
    console.log('Seeding attendance for the current month...');
    for (const worker of activeWorkers) {
      for (let d = new Date(monthStart); d <= now; d.setDate(d.getDate() + 1)) {
        if (d.getDay() === 0) continue; // skip Sundays
        const roll = Math.random();
        const status = roll > 0.92 ? 'absent' : roll > 0.85 ? 'half_day' : 'present';
        await Attendance.findOrCreate({
          where: { worker_id: worker.id, date: dateOnly(d) },
          defaults: {
            worker_id: worker.id, date: dateOnly(d), status,
            ot_hours: status === 'present' && Math.random() > 0.7 ? rand(1, 3) : 0,
            marked_by: supervisor.id, created_by: supervisor.id,
          },
        });
      }
    }
    console.log('Attendance seeded.');
  } else {
    console.log('Attendance for this month already present — skipping.');
  }

  // ─── Validation results (cheap — recompute every run) ────────────────────
  console.log('Running validation checks for active workers...');
  for (const worker of activeWorkers) {
    await runValidation(worker.id, company.id);
  }

  // ─── Payroll (idempotent upsert — recompute every run) ───────────────────
  console.log('Generating payroll for current and previous month...');
  const thisMonth = now.getMonth() + 1;
  const thisYear = now.getFullYear();
  const prevDate = new Date(thisYear, thisMonth - 2, 1);
  await generateMonthlyPayroll({ companyId: company.id, siteId: null, month: thisMonth, year: thisYear, generatedBy: companyAdmin.id });
  await generateMonthlyPayroll({ companyId: company.id, siteId: null, month: prevDate.getMonth() + 1, year: prevDate.getFullYear(), generatedBy: companyAdmin.id });

  console.log('\n================ Demo accounts (all password: Admin@1234) ================');
  console.log(`  Super Admin:       ${superEmail} / ${superPass}`);
  console.log('  Company Admin:     companyadmin@example.com');
  console.log('  Site Supervisor:   supervisor@example.com   (Main Site)');
  console.log('  HR/Payroll:        hrpayroll@example.com');
  console.log('  Auditor:           auditor@example.com');
  console.log('=============================================================================\n');

  await sequelize.close();
  console.log('Seed complete.');
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
