const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Site = sequelize.define('Site', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  company_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  name: { type: DataTypes.STRING(255), allowNull: false },
  location: { type: DataTypes.STRING(500) },
  supervisor_user_id: { type: DataTypes.INTEGER.UNSIGNED },
  status: { type: DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },
  created_by: { type: DataTypes.INTEGER.UNSIGNED },
  updated_by: { type: DataTypes.INTEGER.UNSIGNED },
}, { tableName: 'sites' });

module.exports = Site;
