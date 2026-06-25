const cron = require('node-cron');
const { Company, Subscription } = require('../models');
const { getComplianceScore } = require('../services/reportService');

// Run on 1st of each month at 6:00 AM — generate compliance snapshot
cron.schedule('0 6 1 * *', async () => {
  console.log('[cron] Generating monthly compliance snapshots...');
  try {
    const companies = await Company.findAll({
      where: { status: 'active' },
      include: [{ model: Subscription, as: 'subscription', where: { status: 'active' }, required: false }],
    });

    for (const company of companies) {
      try {
        const { score, breakdown, total } = await getComplianceScore(company.id);
        console.log(`[cron] Company ${company.name} — compliance score: ${score} (${total} workers)`);
        // In a full implementation, store this to a compliance_snapshots table for historical trending.
        // For now, the score is computed live from current data and logged.
      } catch (err) {
        console.error(`[cron] Failed snapshot for ${company.name}:`, err.message);
      }
    }
    console.log('[cron] Compliance snapshots complete.');
  } catch (err) {
    console.error('[cron] Compliance snapshot error:', err.message);
  }
});

module.exports = {};
