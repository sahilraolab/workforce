/**
 * IFSC Master Import Script
 * ─────────────────────────
 * Supports three common formats:
 *
 *  1. RazorpayX CSV  — columns: IFSC,BANK,BRANCH,CENTRE,DISTRICT,STATE,ADDRESS,...
 *  2. NPCI/RBI CSV   — columns: IFSC,BANK_CODE,BRANCH,BANK,STATE,CITY,...
 *  3. JSON array     — [{IFSC, BANK, BRANCH, STATE, CITY}, ...]
 *
 * Usage:
 *   node utils/importIfsc.js /path/to/IFSC.csv
 *   node utils/importIfsc.js /path/to/IFSC.json
 *
 * The script is idempotent — re-running updates existing records.
 * Progress is printed every 5,000 rows.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { sequelize, IfscMaster } = require('../models');

const BATCH_SIZE = 500; // rows per INSERT batch

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node utils/importIfsc.js <path-to-file.csv|.json>');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  await sequelize.authenticate();
  console.log('DB connected.');

  const ext = path.extname(filePath).toLowerCase();
  let records;

  if (ext === '.json') {
    records = await importJson(filePath);
  } else {
    records = await importCsv(filePath);
  }

  console.log(`Parsed ${records.length} records. Starting import...`);
  await bulkUpsert(records);
  await sequelize.close();
}

// ─── JSON import ─────────────────────────────────────────────────────────────

async function importJson(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const arr = Array.isArray(raw) ? raw : Object.values(raw).flat();
  return arr.map(mapRow).filter(Boolean);
}

// ─── CSV import (streaming, handles large files) ──────────────────────────────

async function importCsv(filePath) {
  return new Promise((resolve, reject) => {
    const records = [];
    let headers = null;
    let lineNo = 0;

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      lineNo++;
      if (!line.trim()) return;

      const cols = parseCsvLine(line);

      if (lineNo === 1) {
        headers = cols.map(h => h.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_'));
        return;
      }

      const row = {};
      headers.forEach((h, i) => { row[h] = (cols[i] || '').trim(); });
      const mapped = mapRow(row);
      if (mapped) records.push(mapped);
    });

    rl.on('close', () => resolve(records));
    rl.on('error', reject);
  });
}

// Parse a single CSV line (handles quoted fields with commas)
function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ─── Row mapper — handles column name variations ───────────────────────────

function mapRow(row) {
  // IFSC code — must exist and match format
  const ifsc = (row.IFSC || row.ifsc || row.IFSC_CODE || '').trim().toUpperCase();
  if (!ifsc || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return null;

  const bank = (
    row.BANK || row.BANK_NAME || row.BANKNAME || row.bank_name || ''
  ).trim();

  const branch = (
    row.BRANCH || row.BRANCHNAME || row.BRANCH_NAME || row.branch || ''
  ).trim();

  const city = (
    row.CITY || row.CENTRE || row.DISTRICT || row.city || ''
  ).trim();

  const state = (
    row.STATE || row.state || ''
  ).trim();

  return { ifsc_code: ifsc, bank_name: bank || 'Unknown', branch, city, state };
}

// ─── Bulk upsert in batches ────────────────────────────────────────────────

async function bulkUpsert(records) {
  let inserted = 0;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    await IfscMaster.bulkCreate(batch, {
      updateOnDuplicate: ['bank_name', 'branch', 'city', 'state'],
      ignoreDuplicates: false,
    });
    inserted += batch.length;
    if (inserted % 5000 === 0 || inserted === records.length) {
      console.log(`  Imported ${inserted} / ${records.length} records...`);
    }
  }
  console.log(`\nDone. ${inserted} IFSC records imported/updated.`);
}

main().catch(err => {
  console.error('Import failed:', err.message);
  process.exit(1);
});
