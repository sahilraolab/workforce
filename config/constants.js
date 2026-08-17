module.exports = {
  ROLES: {
    SUPER_ADMIN: 'super_admin',
    COMPANY_ADMIN: 'company_admin',
    SITE_SUPERVISOR: 'site_supervisor',
    HR_PAYROLL: 'hr_payroll',
    AUDITOR: 'auditor',
  },

  WORKER_CATEGORIES: ['Unskilled', 'Semi-Skilled', 'Skilled', 'Executive', 'Manager'],

  ZONES: ['Zone 1', 'Zone 2'],

  ATTENDANCE_STATUS: {
    PRESENT: 'present',
    ABSENT: 'absent',
    HALF_DAY: 'half_day',
  },

  LEAVE_TYPES: {
    CASUAL: 'casual',
    SICK: 'sick',
    EARNED: 'earned',
  },

  LEAVE_STATUS: {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
  },

  DOC_TYPES: {
    AADHAAR: 'aadhaar',
    AADHAAR_BACK: 'aadhaar_back',
    PASSPORT_PHOTO: 'passport_photo',
    BANK_PASSBOOK: 'bank_passbook',
    UAN_CARD: 'uan_card',
    ESIC_CARD: 'esic_card',
  },

  DOC_STATUS: {
    PENDING: 'pending',
    VERIFIED: 'verified',
    REJECTED: 'rejected',
  },

  WORKER_STATUS: {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    DRAFT: 'draft',
  },

  COMPANY_STATUS: {
    ACTIVE: 'active',
    SUSPENDED: 'suspended',
    TRIAL: 'trial',
  },

  LICENSE_TYPES: {
    LABOUR_LICENSE: 'labour_license',
    PF_REGISTRATION: 'pf_registration',
    ESIC_REGISTRATION: 'esic_registration',
    SHOPS_ESTABLISHMENT: 'shops_establishment',
    FACTORY_LICENSE: 'factory_license',
    CONTRACTOR_LICENSE: 'contractor_license',
    GST: 'gst',
    INSURANCE_WC: 'insurance_wc',
    OTHER: 'other',
  },

  LICENSE_EXPIRY_ALERT_DAYS: 30,

  SUBSCRIPTION_PLANS: {
    STARTER: { name: 'Starter', worker_limit: 100 },
    GROWTH: { name: 'Growth', worker_limit: 500 },
    ENTERPRISE: { name: 'Enterprise', worker_limit: null }, // null = unlimited
  },

  // PF/ESIC rates (configurable here)
  PF_RATE: 0.12,
  ESIC_EMPLOYEE_RATE: 0.0075,
  ESIC_EMPLOYER_RATE: 0.0325,

  OT_MULTIPLIER: 2.0, // OT rate = daily_rate * multiplier / 8 per hour

  // Compliance score weights (must sum to 1.0)
  COMPLIANCE_WEIGHTS: {
    documents_verified: 0.25,
    wage_compliant: 0.25,
    age_compliant: 0.15,
    uan_present: 0.15,
    esic_compliant: 0.20,
  },

  // Risk deduction per open flag
  RISK_DEDUCTIONS: {
    missing_doc: 5,
    failed_validation: 10,
    wage_below_minimum: 15,
  },

  PAGINATION_LIMIT: 25,

  FILE_SIZE_LIMITS: {
    photo: 100 * 1024,        // 100 KB
    document: 2 * 1024 * 1024, // 2 MB
  },

  ALLOWED_DOC_MIMES: ['image/jpeg', 'image/png', 'application/pdf'],
  ALLOWED_PHOTO_MIMES: ['image/jpeg', 'image/png'],
};
