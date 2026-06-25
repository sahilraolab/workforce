const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');
const { LICENSE_TYPES } = require('../config/constants');

const CompanyLicense = sequelize.define('CompanyLicense', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  company_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  license_type: { type: DataTypes.ENUM(...Object.values(LICENSE_TYPES)), allowNull: false },
  license_number: { type: DataTypes.STRING(100), allowNull: false },
  issuing_authority: { type: DataTypes.STRING(255) },
  issue_date: { type: DataTypes.DATEONLY },
  expiry_date: { type: DataTypes.DATEONLY, allowNull: false },
  file_path: { type: DataTypes.STRING(500) },
  notes: { type: DataTypes.TEXT },
  created_by: { type: DataTypes.INTEGER.UNSIGNED },
  updated_by: { type: DataTypes.INTEGER.UNSIGNED },
}, {
  tableName: 'company_licenses',
});

module.exports = CompanyLicense;
