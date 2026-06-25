const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const WageMaster = sequelize.define('WageMaster', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  company_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  category: {
    type: DataTypes.ENUM('Unskilled', 'Semi-Skilled', 'Skilled', 'Executive', 'Manager'),
    allowNull: false,
  },
  zone: { type: DataTypes.STRING(100), allowNull: false },
  wage_rate: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  effective_from: { type: DataTypes.DATEONLY, allowNull: false },
  created_by: { type: DataTypes.INTEGER.UNSIGNED },
  updated_by: { type: DataTypes.INTEGER.UNSIGNED },
}, {
  tableName: 'wage_master',
  indexes: [
    { unique: true, fields: ['company_id', 'category', 'zone'], name: 'uidx_wage_cat_zone' },
  ],
});

module.exports = WageMaster;
