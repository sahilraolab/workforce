const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const NotificationLog = sequelize.define('NotificationLog', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  company_id: { type: DataTypes.INTEGER.UNSIGNED },
  type: { type: DataTypes.STRING(100), allowNull: false },
  message: { type: DataTypes.TEXT, allowNull: false },
  recipient: { type: DataTypes.STRING(255), allowNull: false },
  status: { type: DataTypes.ENUM('sent', 'failed', 'pending'), defaultValue: 'pending' },
  sent_at: { type: DataTypes.DATE },
  error_message: { type: DataTypes.TEXT },
}, { tableName: 'notifications_log', updatedAt: false });

module.exports = NotificationLog;
