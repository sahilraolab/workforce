const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Subscription = sequelize.define('Subscription', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  company_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  plan: { type: DataTypes.ENUM('starter', 'growth', 'enterprise'), defaultValue: 'starter' },
  status: { type: DataTypes.ENUM('active', 'expired', 'suspended'), defaultValue: 'active' },
  worker_limit: { type: DataTypes.INTEGER.UNSIGNED }, // null = unlimited
  start_date: { type: DataTypes.DATEONLY, allowNull: false },
  end_date: { type: DataTypes.DATEONLY, allowNull: false },
  created_by: { type: DataTypes.INTEGER.UNSIGNED },
  updated_by: { type: DataTypes.INTEGER.UNSIGNED },
}, {
  tableName: 'subscriptions',
  // Named explicitly — see models/User.js for why inline `unique: true`
  // on a column is unsafe with `sequelize.sync({ alter: true })`.
  indexes: [{ unique: true, fields: ['company_id'], name: 'subscriptions_company_id_unique' }],
});

module.exports = Subscription;
