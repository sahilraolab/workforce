const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const AuditLog = sequelize.define('AuditLog', {
  id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
  company_id: { type: DataTypes.INTEGER.UNSIGNED },
  user_id: { type: DataTypes.INTEGER.UNSIGNED },
  action: { type: DataTypes.ENUM('create', 'update', 'delete', 'verify', 'reject'), allowNull: false },
  entity: { type: DataTypes.STRING(100), allowNull: false },
  entity_id: { type: DataTypes.INTEGER.UNSIGNED },
  before_value: { type: DataTypes.JSON },
  after_value: { type: DataTypes.JSON },
  ip_address: { type: DataTypes.STRING(45) },
  user_agent: { type: DataTypes.STRING(500) },
}, { tableName: 'audit_logs', updatedAt: false });

module.exports = AuditLog;
