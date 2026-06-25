const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Payroll = sequelize.define('Payroll', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  worker_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  month: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false }, // 1–12
  year: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false },
  days_present: { type: DataTypes.DECIMAL(5, 2), defaultValue: 0 },
  days_in_month: { type: DataTypes.TINYINT.UNSIGNED, defaultValue: 26 },
  ot_hours: { type: DataTypes.DECIMAL(6, 2), defaultValue: 0 },
  daily_wage: { type: DataTypes.DECIMAL(10, 2) },
  basic_wage: { type: DataTypes.DECIMAL(10, 2) },
  ot_amount: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  gross: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  pf_applicable: { type: DataTypes.BOOLEAN, defaultValue: false },
  pf_deduction: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  esic_applicable: { type: DataTypes.BOOLEAN, defaultValue: false },
  esic_deduction: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  other_deductions: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
  net_pay: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  generated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  generated_by: { type: DataTypes.INTEGER.UNSIGNED },
  notes: { type: DataTypes.TEXT },
}, {
  tableName: 'payroll',
  indexes: [{ unique: true, fields: ['worker_id', 'month', 'year'] }],
});

module.exports = Payroll;
