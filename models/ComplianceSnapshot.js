const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ComplianceSnapshot = sequelize.define('ComplianceSnapshot', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  company_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  snapshot_month: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
  snapshot_year: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false },
  score: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
  total_workers: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
  breakdown: { type: DataTypes.JSON },
}, {
  tableName: 'compliance_snapshots',
  updatedAt: false,
  indexes: [{ unique: true, fields: ['company_id', 'snapshot_month', 'snapshot_year'] }],
});

module.exports = ComplianceSnapshot;
