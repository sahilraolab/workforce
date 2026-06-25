const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Document = sequelize.define('Document', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  worker_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  doc_type: {
    type: DataTypes.ENUM('aadhaar', 'passport_photo', 'bank_passbook', 'uan_card', 'esic_card'),
    allowNull: false,
  },
  file_path: { type: DataTypes.STRING(500), allowNull: false },
  file_size: { type: DataTypes.INTEGER.UNSIGNED },
  mime_type: { type: DataTypes.STRING(100) },
  original_name: { type: DataTypes.STRING(255) },
  status: { type: DataTypes.ENUM('pending', 'verified', 'rejected'), defaultValue: 'pending' },
  rejection_reason: { type: DataTypes.TEXT },
  uploaded_by: { type: DataTypes.INTEGER.UNSIGNED },
  verified_by: { type: DataTypes.INTEGER.UNSIGNED },
  verified_at: { type: DataTypes.DATE },
  created_by: { type: DataTypes.INTEGER.UNSIGNED },
  updated_by: { type: DataTypes.INTEGER.UNSIGNED },
}, { tableName: 'documents' });

module.exports = Document;
