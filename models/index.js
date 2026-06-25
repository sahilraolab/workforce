const sequelize = require('../config/db');

const Company = require('./Company');
const Site = require('./Site');
const User = require('./User');
const WageMaster = require('./WageMaster');
const Worker = require('./Worker');
const EmploymentDetail = require('./EmploymentDetail');
const Document = require('./Document');
const FamilyMember = require('./FamilyMember');
const ValidationResult = require('./ValidationResult');
const Attendance = require('./Attendance');
const LeaveRecord = require('./LeaveRecord');
const Payroll = require('./Payroll');
const Subscription = require('./Subscription');
const AuditLog = require('./AuditLog');
const IfscMaster = require('./IfscMaster');
const NotificationLog = require('./NotificationLog');
const PasswordResetToken = require('./PasswordResetToken');
const CompanyLicense = require('./CompanyLicense');
const ComplianceFiling = require('./ComplianceFiling');

// Company ↔ Site
Company.hasMany(Site, { foreignKey: 'company_id', as: 'sites' });
Site.belongsTo(Company, { foreignKey: 'company_id', as: 'company' });

// Company ↔ User
Company.hasMany(User, { foreignKey: 'company_id', as: 'users' });
User.belongsTo(Company, { foreignKey: 'company_id', as: 'company' });

// Site ↔ User (supervisor)
Site.belongsTo(User, { foreignKey: 'supervisor_user_id', as: 'supervisor' });
User.hasMany(Site, { foreignKey: 'supervisor_user_id', as: 'supervised_sites' });

// User ↔ Site membership
User.belongsTo(Site, { foreignKey: 'site_id', as: 'site' });
Site.hasMany(User, { foreignKey: 'site_id', as: 'members' });

// Company ↔ WageMaster
Company.hasMany(WageMaster, { foreignKey: 'company_id', as: 'wage_masters' });
WageMaster.belongsTo(Company, { foreignKey: 'company_id', as: 'company' });

// Company ↔ Worker
Company.hasMany(Worker, { foreignKey: 'company_id', as: 'workers' });
Worker.belongsTo(Company, { foreignKey: 'company_id', as: 'company' });

// Site ↔ Worker
Site.hasMany(Worker, { foreignKey: 'site_id', as: 'workers' });
Worker.belongsTo(Site, { foreignKey: 'site_id', as: 'site' });

// Worker ↔ EmploymentDetail (1:1)
Worker.hasOne(EmploymentDetail, { foreignKey: 'worker_id', as: 'employment' });
EmploymentDetail.belongsTo(Worker, { foreignKey: 'worker_id', as: 'worker' });

// Worker ↔ Documents
Worker.hasMany(Document, { foreignKey: 'worker_id', as: 'documents' });
Document.belongsTo(Worker, { foreignKey: 'worker_id', as: 'worker' });

// Worker ↔ FamilyMember
Worker.hasMany(FamilyMember, { foreignKey: 'worker_id', as: 'family_members' });
FamilyMember.belongsTo(Worker, { foreignKey: 'worker_id', as: 'worker' });

// Worker ↔ ValidationResult
Worker.hasMany(ValidationResult, { foreignKey: 'worker_id', as: 'validation_results' });
ValidationResult.belongsTo(Worker, { foreignKey: 'worker_id', as: 'worker' });

// Worker ↔ Attendance
Worker.hasMany(Attendance, { foreignKey: 'worker_id', as: 'attendances' });
Attendance.belongsTo(Worker, { foreignKey: 'worker_id', as: 'worker' });

// Worker ↔ LeaveRecord
Worker.hasMany(LeaveRecord, { foreignKey: 'worker_id', as: 'leave_records' });
LeaveRecord.belongsTo(Worker, { foreignKey: 'worker_id', as: 'worker' });

// Worker ↔ Payroll
Worker.hasMany(Payroll, { foreignKey: 'worker_id', as: 'payrolls' });
Payroll.belongsTo(Worker, { foreignKey: 'worker_id', as: 'worker' });

// Company ↔ Subscription
Company.hasOne(Subscription, { foreignKey: 'company_id', as: 'subscription' });
Subscription.belongsTo(Company, { foreignKey: 'company_id', as: 'company' });

// Company ↔ AuditLog
Company.hasMany(AuditLog, { foreignKey: 'company_id', as: 'audit_logs' });
AuditLog.belongsTo(Company, { foreignKey: 'company_id', as: 'company' });

// Company ↔ NotificationLog
Company.hasMany(NotificationLog, { foreignKey: 'company_id', as: 'notification_logs' });
NotificationLog.belongsTo(Company, { foreignKey: 'company_id', as: 'company' });

// User ↔ AuditLog
User.hasMany(AuditLog, { foreignKey: 'user_id', as: 'audit_logs' });
AuditLog.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Document ↔ User (uploaded_by)
User.hasMany(Document, { foreignKey: 'uploaded_by', as: 'uploaded_documents' });
Document.belongsTo(User, { foreignKey: 'uploaded_by', as: 'uploader' });

// Attendance ↔ User (marked_by)
User.hasMany(Attendance, { foreignKey: 'marked_by', as: 'marked_attendances' });
Attendance.belongsTo(User, { foreignKey: 'marked_by', as: 'marked_by_user' });

// Company ↔ CompanyLicense
Company.hasMany(CompanyLicense, { foreignKey: 'company_id', as: 'licenses' });
CompanyLicense.belongsTo(Company, { foreignKey: 'company_id', as: 'company' });

// Company ↔ ComplianceFiling
Company.hasMany(ComplianceFiling, { foreignKey: 'company_id', as: 'compliance_filings' });
ComplianceFiling.belongsTo(Company, { foreignKey: 'company_id', as: 'company' });

// ComplianceFiling ↔ User (filed_by)
User.hasMany(ComplianceFiling, { foreignKey: 'filed_by', as: 'filed_compliance_filings' });
ComplianceFiling.belongsTo(User, { foreignKey: 'filed_by', as: 'filer' });

module.exports = {
  sequelize,
  Company,
  Site,
  User,
  WageMaster,
  Worker,
  EmploymentDetail,
  Document,
  FamilyMember,
  ValidationResult,
  Attendance,
  LeaveRecord,
  Payroll,
  Subscription,
  AuditLog,
  IfscMaster,
  NotificationLog,
  PasswordResetToken,
  CompanyLicense,
  ComplianceFiling,
};
