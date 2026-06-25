const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const IfscMaster = sequelize.define('IfscMaster', {
  ifsc_code: { type: DataTypes.STRING(11), primaryKey: true },
  bank_name: { type: DataTypes.STRING(255), allowNull: false },
  branch: { type: DataTypes.STRING(255) },
  city: { type: DataTypes.STRING(100) },
  state: { type: DataTypes.STRING(100) },
}, { tableName: 'ifsc_master', timestamps: false });

module.exports = IfscMaster;
