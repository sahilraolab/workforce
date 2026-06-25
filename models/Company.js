const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Company = sequelize.define('Company', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING(255), allowNull: false },
  status: { type: DataTypes.ENUM('active', 'suspended', 'trial'), defaultValue: 'trial' },
  plan: { type: DataTypes.ENUM('starter', 'growth', 'enterprise'), defaultValue: 'starter' },
  address: { type: DataTypes.TEXT },
  contact_email: { type: DataTypes.STRING(255) },
  contact_phone: { type: DataTypes.STRING(20) },
  created_by: { type: DataTypes.INTEGER.UNSIGNED },
}, { tableName: 'companies' });

module.exports = Company;
