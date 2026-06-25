const { AuditLog } = require('../models');

async function logAudit(req, { action, entity, entity_id, before_value = null, after_value = null }) {
  try {
    await AuditLog.create({
      company_id: req.tenantScope?.company_id || null,
      user_id: req.session?.user?.id || null,
      action,
      entity,
      entity_id,
      before_value,
      after_value,
      ip_address: req.ip,
      user_agent: req.headers['user-agent']?.substring(0, 500),
    });
  } catch (err) {
    // Audit log failure must never break the main request
    console.error('Audit log error:', err.message);
  }
}

module.exports = { logAudit };
