const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const PasswordResetToken = sequelize.define('PasswordResetToken', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  token_hash: { type: DataTypes.STRING(255), allowNull: false },
  expires_at: { type: DataTypes.DATE, allowNull: false },
  used: { type: DataTypes.BOOLEAN, defaultValue: false },
}, { tableName: 'password_reset_tokens', updatedAt: false });

module.exports = PasswordResetToken;
