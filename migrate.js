/**
 * Production migration script — Phase 2
 * Run once on the server before restarting the app:
 *   node migrate.js
 *
 * Safe to re-run: every step checks before acting.
 */

require('dotenv').config();
const { sequelize } = require('./models');
const qi = sequelize.getQueryInterface();

async function hasColumn(table, column) {
  const cols = await qi.describeTable(table);
  return !!cols[column];
}

async function addCol(table, column, opts) {
  if (await hasColumn(table, column)) {
    console.log(`  SKIP  ${table}.${column} — already exists`);
  } else {
    await qi.addColumn(table, column, opts);
    console.log(`  ADD   ${table}.${column} ✅`);
  }
}

async function rawSQL(sql, label) {
  try {
    await sequelize.query(sql);
    console.log(`  OK    ${label} ✅`);
  } catch (err) {
    console.error(`  FAIL  ${label} — ${err.message}`);
    throw err;
  }
}

async function run() {
  const { DataTypes } = require('sequelize');
  await sequelize.authenticate();
  console.log('Connected to DB.\n');

  // ── 1. AuditLog: expand action ENUM ─────────────────────────────────────────
  console.log('[1/6] AuditLog — expand action ENUM');
  await rawSQL(
    `ALTER TABLE \`audit_logs\` MODIFY COLUMN \`action\`
     ENUM('create','update','delete','verify','reject','generate','export','login')
     NOT NULL`,
    'audit_logs.action ENUM expanded'
  );

  // ── 2. Company: add regulatory_regime + jurisdiction ─────────────────────────
  console.log('\n[2/6] Company — add regulatory_regime + jurisdiction');
  await addCol('companies', 'regulatory_regime', {
    type: DataTypes.ENUM('code_on_wages_2019', 'osh_code_2020'),
    defaultValue: 'code_on_wages_2019',
    after: 'plan',
  });
  await addCol('companies', 'jurisdiction', {
    type: DataTypes.ENUM('central', 'gujarat'),
    defaultValue: 'central',
    after: 'regulatory_regime',
  });

  // ── 3. EmploymentDetail: zone ENUM → VARCHAR(100) ────────────────────────────
  console.log('\n[3/6] EmploymentDetail — change zone from ENUM to VARCHAR(100)');
  await rawSQL(
    `ALTER TABLE \`employment_details\` MODIFY COLUMN \`zone\` VARCHAR(100) NOT NULL`,
    'employment_details.zone → VARCHAR(100)'
  );

  // ── 4. Document: expand doc_type ENUM + add source/period cols ───────────────
  console.log('\n[4/6] Document — expand doc_type ENUM + add source, period_month, period_year');
  await rawSQL(
    `ALTER TABLE \`documents\` MODIFY COLUMN \`doc_type\`
     ENUM('aadhaar','passport_photo','bank_passbook','uan_card','esic_card',
          'salary_slip','muster_roll','wage_register','offer_letter','service_certificate')
     NOT NULL`,
    'documents.doc_type ENUM expanded'
  );
  await addCol('documents', 'source', {
    type: DataTypes.ENUM('upload', 'generated'),
    defaultValue: 'upload',
    after: 'doc_type',
  });
  await addCol('documents', 'period_month', {
    type: DataTypes.TINYINT.UNSIGNED,
    allowNull: true,
    after: 'source',
  });
  await addCol('documents', 'period_year', {
    type: DataTypes.SMALLINT.UNSIGNED,
    allowNull: true,
    after: 'period_month',
  });

  // ── 5. ValidationResult: add override columns ─────────────────────────────────
  console.log('\n[5/6] ValidationResult — add overridden, override_note, override_by, override_at');
  await addCol('validation_results', 'overridden', {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    after: 'checked_at',
  });
  await addCol('validation_results', 'override_note', {
    type: DataTypes.TEXT,
    allowNull: true,
    after: 'overridden',
  });
  await addCol('validation_results', 'override_by', {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
    after: 'override_note',
  });
  await addCol('validation_results', 'override_at', {
    type: DataTypes.DATE,
    allowNull: true,
    after: 'override_by',
  });

  // ── 6. ComplianceSnapshot: create table if missing ───────────────────────────
  console.log('\n[6/7] ComplianceSnapshot — create table if not exists');
  await rawSQL(
    `CREATE TABLE IF NOT EXISTS \`compliance_snapshots\` (
      \`id\`             INT UNSIGNED      NOT NULL AUTO_INCREMENT,
      \`company_id\`     INT UNSIGNED      NOT NULL,
      \`snapshot_month\` TINYINT UNSIGNED  NOT NULL,
      \`snapshot_year\`  SMALLINT UNSIGNED NOT NULL,
      \`score\`          DECIMAL(5,2)      NOT NULL,
      \`total_workers\`  INT UNSIGNED      DEFAULT 0,
      \`breakdown\`      JSON,
      \`createdAt\`      DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uq_snapshot\` (\`company_id\`, \`snapshot_month\`, \`snapshot_year\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    'compliance_snapshots table'
  );

  // ── 7. Document: add OCR autofill/verification columns ───────────────────────
  console.log('\n[7/9] Document — add ocr_data, ocr_match');
  await addCol('documents', 'ocr_data', {
    type: DataTypes.JSON,
    allowNull: true,
    after: 'original_name',
  });
  await addCol('documents', 'ocr_match', {
    type: DataTypes.ENUM('match', 'mismatch', 'unchecked'),
    defaultValue: 'unchecked',
    after: 'ocr_data',
  });

  // ── 8. Document: allow storing the Aadhaar back side separately ──────────────
  console.log('\n[8/9] Document — expand doc_type ENUM with aadhaar_back');
  await rawSQL(
    `ALTER TABLE \`documents\` MODIFY COLUMN \`doc_type\`
     ENUM('aadhaar','aadhaar_back','passport_photo','bank_passbook','uan_card','esic_card',
          'salary_slip','muster_roll','wage_register','offer_letter','service_certificate')
     NOT NULL`,
    'documents.doc_type ENUM expanded with aadhaar_back'
  );

  // ── 9. PAN card: worker fields + document type ────────────────────────────────
  console.log('\n[9/9] Worker — add pan_encrypted, pan_last4; Document — add pan_card doc_type');
  await addCol('workers', 'pan_encrypted', {
    type: DataTypes.TEXT,
    allowNull: true,
    after: 'aadhaar_last4',
  });
  await addCol('workers', 'pan_last4', {
    type: DataTypes.CHAR(4),
    allowNull: true,
    after: 'pan_encrypted',
  });
  await rawSQL(
    `ALTER TABLE \`documents\` MODIFY COLUMN \`doc_type\`
     ENUM('aadhaar','aadhaar_back','pan_card','passport_photo','bank_passbook','uan_card','esic_card',
          'salary_slip','muster_roll','wage_register','offer_letter','service_certificate')
     NOT NULL`,
    'documents.doc_type ENUM expanded with pan_card'
  );

  console.log('\n✅ All migrations complete. Safe to restart the app.');
  await sequelize.close();
}

run().catch(err => {
  console.error('\n❌ Migration failed:', err.message);
  process.exit(1);
});
