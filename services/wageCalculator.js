const { PF_RATE, ESIC_EMPLOYEE_RATE, OT_MULTIPLIER } = require('../config/constants');

/**
 * Calculate payroll for a single worker-month.
 * All monetary values are in INR and rounded to 2 decimal places.
 */
function calculatePayroll({ wageRate, daysPresent, daysInMonth = 26, otHours = 0, pfApplicable = false, esicApplicable = false }) {
  const dailyWage = parseFloat(wageRate) || 0;
  const days = parseFloat(daysPresent) || 0;
  const ot = parseFloat(otHours) || 0;
  const totalDays = parseInt(daysInMonth, 10) || 26;

  const basicWage = round(dailyWage * days);
  // OT rate = daily_wage / 8 * OT_MULTIPLIER per hour
  const hourlyRate = dailyWage / 8;
  const otAmount = round(hourlyRate * OT_MULTIPLIER * ot);
  const gross = round(basicWage + otAmount);

  const pfDeduction = pfApplicable ? round(gross * PF_RATE) : 0;
  const esicDeduction = esicApplicable ? round(gross * ESIC_EMPLOYEE_RATE) : 0;
  const netPay = round(gross - pfDeduction - esicDeduction);

  return {
    dailyWage,
    daysPresent: days,
    daysInMonth: totalDays,
    otHours: ot,
    basicWage,
    otAmount,
    gross,
    pfApplicable,
    pfDeduction,
    esicApplicable,
    esicDeduction,
    netPay,
  };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { calculatePayroll };
