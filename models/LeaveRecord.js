const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const LeaveRecord = sequelize.define('LeaveRecord', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  worker_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  leave_type: { type: DataTypes.ENUM('casual', 'sick', 'earned'), allowNull: false },
  from_date: { type: DataTypes.DATEONLY, allowNull: false },
  to_date: { type: DataTypes.DATEONLY, allowNull: false },
  days: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  reason: { type: DataTypes.TEXT },
  status: { type: DataTypes.ENUM('pending', 'approved', 'rejected'), defaultValue: 'pending' },
  approved_by: { type: DataTypes.INTEGER.UNSIGNED },
  rejection_reason: { type: DataTypes.TEXT },
  created_by: { type: DataTypes.INTEGER.UNSIGNED },
  updated_by: { type: DataTypes.INTEGER.UNSIGNED },
}, { tableName: 'leave_records' });

module.exports = LeaveRecord;
