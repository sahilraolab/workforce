const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Attendance = sequelize.define('Attendance', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  worker_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  date: { type: DataTypes.DATEONLY, allowNull: false },
  status: { type: DataTypes.ENUM('present', 'absent', 'half_day'), allowNull: false },
  ot_hours: { type: DataTypes.DECIMAL(4, 2), defaultValue: 0 },
  notes: { type: DataTypes.STRING(255), allowNull: true },
  marked_by: { type: DataTypes.INTEGER.UNSIGNED },
  created_by: { type: DataTypes.INTEGER.UNSIGNED },
  updated_by: { type: DataTypes.INTEGER.UNSIGNED },
}, {
  tableName: 'attendance',
  indexes: [{ unique: true, fields: ['worker_id', 'date'] }],
});

module.exports = Attendance;
