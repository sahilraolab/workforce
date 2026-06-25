const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ValidationResult = sequelize.define('ValidationResult', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  worker_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  check_name: { type: DataTypes.STRING(100), allowNull: false },
  result: { type: DataTypes.ENUM('pass', 'fail', 'na'), allowNull: false },
  details: { type: DataTypes.TEXT },
  checked_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, { tableName: 'validation_results', updatedAt: false });

module.exports = ValidationResult;
