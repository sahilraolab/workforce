const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Worker = sequelize.define('Worker', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  company_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  site_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  name: { type: DataTypes.STRING(255), allowNull: false },
  father_name: { type: DataTypes.STRING(255), allowNull: false },
  dob: { type: DataTypes.DATEONLY, allowNull: false },
  gender: { type: DataTypes.ENUM('Male', 'Female', 'Other'), allowNull: false },
  aadhaar_encrypted: { type: DataTypes.TEXT },
  aadhaar_last4: { type: DataTypes.CHAR(4) },
  address_aadhaar: { type: DataTypes.TEXT, allowNull: false },
  present_address: { type: DataTypes.TEXT },
  mobile: { type: DataTypes.STRING(15), allowNull: false },
  email: { type: DataTypes.STRING(255) },
  marital_status: { type: DataTypes.ENUM('Single', 'Married', 'Widowed', 'Divorced') },
  status: { type: DataTypes.ENUM('active', 'inactive', 'draft'), defaultValue: 'draft' },
  bank_account_encrypted: { type: DataTypes.TEXT },
  bank_account_last4: { type: DataTypes.CHAR(4) },
  ifsc_code: { type: DataTypes.STRING(11) },
  created_by: { type: DataTypes.INTEGER.UNSIGNED },
  updated_by: { type: DataTypes.INTEGER.UNSIGNED },
}, { tableName: 'workers' });

module.exports = Worker;
