const cron = require('node-cron');
const { Company, Subscription, ComplianceSnapshot } = require('../models');
const { getComplianceScore } = require('../services/reportService');

async function runComplianceSnapshot() {
  const now = new Date();
  // Snapshot the month that just ended (previous month)
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const snapshotMonth = d.getMonth() + 1;
  const snapshotYear = d.getFullYear();

  console.log(`[cron] Generating compliance snapshots for ${snapshotMonth}/${snapshotYear}...`);
  const companies = await Company.findAll({
    where: { status: 'active' },
    include: [{ model: Subscription, as: 'subscription', where: { status: 'active' }, required: false }],
  });

  for (const company of companies) {
    try {
      const { score, breakdown, total } = await getComplianceScore(company.id);
      await ComplianceSnapshot.upsert({
        company_id: company.id,
        snapshot_month: snapshotMonth,
        snapshot_year: snapshotYear,
        score,
        total_workers: total,
        breakdown,
      });
      console.log(`[cron] ${company.name} — score: ${score}%, workers: ${total}`);
    } catch (err) {
      console.error(`[cron] Failed snapshot for ${company.name}:`, err.message);
    }
  }
  console.log('[cron] Compliance snapshots complete.');
}

// Run on 1st of each month at 6:00 AM
cron.schedule('0 6 1 * *', async () => {
  try { await runComplianceSnapshot(); }
  catch (err) { console.error('[cron] Compliance snapshot error:', err.message); }
});

module.exports = { runComplianceSnapshot };
