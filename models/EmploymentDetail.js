const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const EmploymentDetail = sequelize.define('EmploymentDetail', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  worker_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  category: {
    type: DataTypes.ENUM('Unskilled', 'Semi-Skilled', 'Skilled', 'Executive', 'Manager'),
    allowNull: false,
  },
  zone: { type: DataTypes.ENUM('Zone 1', 'Zone 2'), allowNull: false },
  wage_rate: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  doj: { type: DataTypes.DATEONLY, allowNull: false },
  uan_encrypted: { type: DataTypes.TEXT },
  uan_last4: { type: DataTypes.CHAR(4) },
  esic_applicable: { type: DataTypes.BOOLEAN, defaultValue: false },
  esic_encrypted: { type: DataTypes.TEXT },
  esic_last4: { type: DataTypes.CHAR(4) },
  wage_override_reason: { type: DataTypes.TEXT },
  created_by: { type: DataTypes.INTEGER.UNSIGNED },
  updated_by: { type: DataTypes.INTEGER.UNSIGNED },
}, { tableName: 'employment_details' });

module.exports = EmploymentDetail;
