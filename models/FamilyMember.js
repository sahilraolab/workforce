const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const FamilyMember = sequelize.define('FamilyMember', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  worker_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  relation: { type: DataTypes.ENUM('spouse', 'child'), allowNull: false },
  name: { type: DataTypes.STRING(255), allowNull: false },
  aadhaar_encrypted: { type: DataTypes.TEXT },
  aadhaar_last4: { type: DataTypes.CHAR(4) },
  photo_path: { type: DataTypes.STRING(500) },
  created_by: { type: DataTypes.INTEGER.UNSIGNED },
  updated_by: { type: DataTypes.INTEGER.UNSIGNED },
}, { tableName: 'family_members' });

module.exports = FamilyMember;
