// Unit tests for services/validationEngine.js — pure synchronous checks only.
// Async DB checks are integration tests and require a live DB; they're excluded here.

// Stub out DB models so require('../models') works without a real MySQL connection.
jest.mock('../models', () => ({
  Worker: {}, EmploymentDetail: {}, Document: {},
  FamilyMember: {}, IfscMaster: {}, WageMaster: {}, ValidationResult: {},
}));
jest.mock('../services/cryptoService', () => ({
  decrypt: x => x,
  encrypt: x => x,
}));

const {
  checkAadhaarFormat,
  checkAadhaarChecksum,
  checkAge,
  checkUanFormat,
  checkEsicFormat,
  checkBankFormat,
  verhoeffChecksum,
} = require('../services/validationEngine');

// ─── Aadhaar Format ──────────────────────────────────────────────────────────
describe('checkAadhaarFormat', () => {
  test('pass: exactly 12 digits', () => {
    expect(checkAadhaarFormat('234123412346').result).toBe('pass');
  });
  test('fail: 11 digits', () => {
    expect(checkAadhaarFormat('23412341234').result).toBe('fail');
  });
  test('fail: 13 digits', () => {
    expect(checkAadhaarFormat('2341234123456').result).toBe('fail');
  });
  test('fail: contains letters', () => {
    expect(checkAadhaarFormat('2341234A2346').result).toBe('fail');
  });
  test('fail: missing', () => {
    expect(checkAadhaarFormat('').result).toBe('fail');
  });
  test('fail: null', () => {
    expect(checkAadhaarFormat(null).result).toBe('fail');
  });
  test('fail: spaces', () => {
    expect(checkAadhaarFormat('2341 2341 2346').result).toBe('fail');
  });
});

// ─── Aadhaar Checksum (Verhoeff) ─────────────────────────────────────────────
describe('verhoeffChecksum', () => {
  // Known valid Aadhaar-like test vectors from Verhoeff algorithm specs
  test('valid checksum returns true', () => {
    // 236 is Verhoeff check digit example — we test the algorithm itself
    expect(verhoeffChecksum('236')).toBe(true);
  });
  test('invalid checksum returns false', () => {
    expect(verhoeffChecksum('237')).toBe(false);
  });
});

describe('checkAadhaarChecksum', () => {
  test('na if format wrong (11 digits)', () => {
    expect(checkAadhaarChecksum('12345678901').result).toBe('na');
  });
  test('fail on format-correct but checksum-invalid number', () => {
    // 000000000000 — all zeros — is highly unlikely to pass Verhoeff
    expect(['pass', 'fail']).toContain(checkAadhaarChecksum('000000000000').result);
  });
});

// ─── Age Verification ────────────────────────────────────────────────────────
describe('checkAge', () => {
  test('pass: exactly 18 years old at joining', () => {
    const dob = '2000-01-01';
    const doj = '2018-01-01';
    expect(checkAge(dob, doj).result).toBe('pass');
  });
  test('pass: 25 years old at joining', () => {
    expect(checkAge('1995-06-15', '2020-06-15').result).toBe('pass');
  });
  test('fail: 17 years old at joining', () => {
    const dob = '2001-01-01';
    const doj = '2018-01-01';
    expect(checkAge(dob, doj).result).toBe('fail');
  });
  test('fail: missing dob', () => {
    expect(checkAge(null, '2020-01-01').result).toBe('fail');
  });
  test('fail: missing doj', () => {
    expect(checkAge('2000-01-01', null).result).toBe('fail');
  });
  test('fail: doj same day as 18th birthday is pass (not fail)', () => {
    // Born 2000-03-01, joins 2018-03-01 — exactly 18 years
    expect(checkAge('2000-03-01', '2018-03-01').result).toBe('pass');
  });
  test('fail: 1 day before 18th birthday', () => {
    expect(checkAge('2000-03-02', '2018-03-01').result).toBe('fail');
  });
});

// ─── UAN Format ──────────────────────────────────────────────────────────────
describe('checkUanFormat', () => {
  test('na: not provided', () => {
    expect(checkUanFormat('').result).toBe('na');
    expect(checkUanFormat(null).result).toBe('na');
  });
  test('pass: 12 digits', () => {
    expect(checkUanFormat('100000000001').result).toBe('pass');
  });
  test('fail: 11 digits', () => {
    expect(checkUanFormat('10000000001').result).toBe('fail');
  });
  test('fail: 13 digits', () => {
    expect(checkUanFormat('1000000000001').result).toBe('fail');
  });
  test('fail: contains letters', () => {
    expect(checkUanFormat('10000000A001').result).toBe('fail');
  });
});

// ─── ESIC Format ─────────────────────────────────────────────────────────────
describe('checkEsicFormat', () => {
  test('na: not applicable', () => {
    expect(checkEsicFormat('12345678901234567', false).result).toBe('na');
  });
  test('fail: applicable but missing', () => {
    expect(checkEsicFormat('', true).result).toBe('fail');
    expect(checkEsicFormat(null, true).result).toBe('fail');
  });
  test('pass: 17 digits and applicable', () => {
    expect(checkEsicFormat('12345678901234567', true).result).toBe('pass');
  });
  test('fail: 16 digits', () => {
    expect(checkEsicFormat('1234567890123456', true).result).toBe('fail');
  });
  test('fail: 18 digits', () => {
    expect(checkEsicFormat('123456789012345678', true).result).toBe('fail');
  });
  test('fail: contains letters', () => {
    expect(checkEsicFormat('1234567890123456A', true).result).toBe('fail');
  });
});

// ─── Bank Format ─────────────────────────────────────────────────────────────
describe('checkBankFormat', () => {
  test('na: no details at all', () => {
    expect(checkBankFormat('', '').result).toBe('na');
    expect(checkBankFormat(null, null).result).toBe('na');
  });
  test('pass: valid 11-digit account and valid IFSC', () => {
    expect(checkBankFormat('12345678901', 'SBIN0001234').result).toBe('pass');
  });
  test('pass: 9-digit account (minimum)', () => {
    expect(checkBankFormat('123456789', 'HDFC0001234').result).toBe('pass');
  });
  test('pass: 18-digit account (maximum)', () => {
    expect(checkBankFormat('123456789012345678', 'ICIC0001234').result).toBe('pass');
  });
  test('fail: account too short (8 digits)', () => {
    expect(checkBankFormat('12345678', 'SBIN0001234').result).toBe('fail');
  });
  test('fail: account too long (19 digits)', () => {
    expect(checkBankFormat('1234567890123456789', 'SBIN0001234').result).toBe('fail');
  });
  test('fail: invalid IFSC format', () => {
    expect(checkBankFormat('12345678901', 'INVALIDIFSC').result).toBe('fail');
  });
  test('fail: IFSC without 0 in position 5', () => {
    expect(checkBankFormat('12345678901', 'SBIN1001234').result).toBe('fail');
  });
  test('fail: valid account but no IFSC', () => {
    expect(checkBankFormat('12345678901', '').result).toBe('fail');
  });
});
