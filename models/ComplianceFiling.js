const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ComplianceFiling = sequelize.define('ComplianceFiling', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  company_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  filing_type: { type: DataTypes.ENUM('pf', 'esic'), allowNull: false },
  period_month: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false }, // 1–12
  period_year: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false },
  total_amount: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  status: { type: DataTypes.ENUM('pending', 'filed'), defaultValue: 'pending' },
  challan_no: { type: DataTypes.STRING(100) },
  filed_date: { type: DataTypes.DATEONLY },
  filed_by: { type: DataTypes.INTEGER.UNSIGNED },
  notes: { type: DataTypes.TEXT },
}, {
  tableName: 'compliance_filings',
  // Named explicitly — see models/Subscription.js for why inline `unique: true`
  // on a column is unsafe with `sequelize.sync({ alter: true })`.
  indexes: [{ unique: true, fields: ['company_id', 'filing_type', 'period_month', 'period_year'], name: 'compliance_filings_period_unique' }],
});

module.exports = ComplianceFiling;
