const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  company_id: { type: DataTypes.INTEGER.UNSIGNED }, // null for super_admin
  site_id: { type: DataTypes.INTEGER.UNSIGNED },    // null unless site_supervisor
  name: { type: DataTypes.STRING(255), allowNull: false },
  email: { type: DataTypes.STRING(255), allowNull: false },
  password_hash: { type: DataTypes.STRING(255), allowNull: false },
  role: {
    type: DataTypes.ENUM('super_admin', 'company_admin', 'site_supervisor', 'hr_payroll', 'auditor'),
    allowNull: false,
  },
  status: { type: DataTypes.ENUM('active', 'inactive', 'invited'), defaultValue: 'active' },
  last_login_at: { type: DataTypes.DATE },
  created_by: { type: DataTypes.INTEGER.UNSIGNED },
  updated_by: { type: DataTypes.INTEGER.UNSIGNED },
}, {
  tableName: 'users',
  // Named explicitly (rather than inline `unique: true` on the column) so
  // `sequelize.sync({ alter: true })` recognizes the existing constraint on
  // restart instead of creating a new auto-named unique index every time —
  // that bug previously piled up 60+ duplicate indexes on this column and
  // eventually hit MySQL's 64-key-per-table limit, taking the server down.
  indexes: [{ unique: true, fields: ['email'], name: 'users_email_unique' }],
});

module.exports = User;
