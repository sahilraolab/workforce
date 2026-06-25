// Internal AJAX API routes (no CSRF needed — JSON only, guarded by session)
const router = require('express').Router();
const { isLoggedIn } = require('../middlewares/auth');
const { WageMaster, IfscMaster, Worker } = require('../models');

// Wage lookup for wizard AJAX (Step 2)
router.get('/wage-lookup', isLoggedIn, async (req, res) => {
  const { category, zone } = req.query;
  const companyId = req.tenantScope.company_id;
  if (!category || !zone || !companyId) return res.json({ wage_rate: null });

  try {
    const wm = await WageMaster.findOne({
      where: { company_id: companyId, category, zone },
      order: [['effective_from', 'DESC']],
    });
    res.json({ wage_rate: wm ? wm.wage_rate : null });
  } catch {
    res.json({ wage_rate: null });
  }
});

// IFSC lookup
router.get('/ifsc/:code', isLoggedIn, async (req, res) => {
  try {
    const record = await IfscMaster.findByPk(req.params.code.toUpperCase());
    if (!record) return res.json({ found: false });
    res.json({ found: true, bank_name: record.bank_name, branch: record.branch });
  } catch {
    res.json({ found: false });
  }
});

module.exports = router;
