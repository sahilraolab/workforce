// Unit tests for services/wageCalculator.js — pure function, no DB required.

const { calculatePayroll } = require('../services/wageCalculator');

describe('calculatePayroll', () => {
  test('basic wage = daily rate × days present, no OT, no deductions', () => {
    const r = calculatePayroll({ wageRate: 500, daysPresent: 20 });
    expect(r.basicWage).toBe(10000);
    expect(r.otAmount).toBe(0);
    expect(r.gross).toBe(10000);
    expect(r.pfDeduction).toBe(0);
    expect(r.esicDeduction).toBe(0);
    expect(r.netPay).toBe(10000);
  });

  test('overtime is paid at 2x the hourly rate (daily_wage / 8 hours)', () => {
    // 500/day -> hourly = 62.5 -> OT rate = 125/hr
    const r = calculatePayroll({ wageRate: 500, daysPresent: 0, otHours: 4 });
    expect(r.otAmount).toBe(500); // 125 * 4
  });

  test('PF deducted at 12% of gross when applicable', () => {
    const r = calculatePayroll({ wageRate: 1000, daysPresent: 10, pfApplicable: true });
    expect(r.gross).toBe(10000);
    expect(r.pfDeduction).toBe(1200);
  });

  test('ESIC deducted at 0.75% of gross when applicable', () => {
    const r = calculatePayroll({ wageRate: 1000, daysPresent: 10, esicApplicable: true });
    expect(r.esicDeduction).toBe(75);
  });

  test('PF and ESIC both deducted, net pay reflects both', () => {
    const r = calculatePayroll({ wageRate: 1000, daysPresent: 10, pfApplicable: true, esicApplicable: true });
    expect(r.gross).toBe(10000);
    expect(r.pfDeduction).toBe(1200);
    expect(r.esicDeduction).toBe(75);
    expect(r.netPay).toBe(8725);
  });

  test('zero days present -> zero gross, zero net pay', () => {
    const r = calculatePayroll({ wageRate: 800, daysPresent: 0 });
    expect(r.gross).toBe(0);
    expect(r.netPay).toBe(0);
  });

  test('half-day attendance (decimal daysPresent) is honored', () => {
    const r = calculatePayroll({ wageRate: 600, daysPresent: 10.5 });
    expect(r.basicWage).toBe(6300);
  });

  test('missing/invalid wageRate defaults to 0 instead of NaN', () => {
    const r = calculatePayroll({ wageRate: undefined, daysPresent: 20 });
    expect(r.dailyWage).toBe(0);
    expect(r.gross).toBe(0);
    expect(Number.isNaN(r.gross)).toBe(false);
  });

  test('negative daysPresent is not clamped — caller is expected to validate upstream', () => {
    // Documents current behavior so a future change here is a deliberate decision, not a regression.
    const r = calculatePayroll({ wageRate: 500, daysPresent: -5 });
    expect(r.gross).toBe(-2500);
  });

  test('monetary values are rounded to 2 decimal places', () => {
    const r = calculatePayroll({ wageRate: 333.33, daysPresent: 3, otHours: 1.5 });
    expect(r.gross.toString()).toMatch(/^\d+(\.\d{1,2})?$/);
  });
});
