const { Op } = require('sequelize');
const { Worker, EmploymentDetail, Attendance, Payroll } = require('../models');
const { calculatePayroll } = require('./wageCalculator');

/**
 * Generate payroll for all active workers in a company/site for a given month.
 * Idempotent — overwrites existing payroll records for the month.
 */
async function generateMonthlyPayroll({ companyId, siteId, month, year, generatedBy }) {
  const where = { company_id: companyId, status: 'active' };
  if (siteId) where.site_id = siteId;

  const workers = await Worker.findAll({
    where,
    include: [{ model: EmploymentDetail, as: 'employment' }],
  });

  const daysInMonth = new Date(year, month, 0).getDate();
  // Standard working days: approximate as actual days present in attendance
  const results = [];

  for (const worker of workers) {
    const emp = worker.employment;
    if (!emp) continue;

    // Count attendance for the month
    const attendance = await Attendance.findAll({
      where: {
        worker_id: worker.id,
        date: {
          [Op.between]: [
            `${year}-${String(month).padStart(2, '0')}-01`,
            `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`,
          ],
        },
      },
    });

    let daysPresent = 0;
    let otHours = 0;
    attendance.forEach(a => {
      if (a.status === 'present') daysPresent += 1;
      else if (a.status === 'half_day') daysPresent += 0.5;
      otHours += parseFloat(a.ot_hours) || 0;
    });

    const calc = calculatePayroll({
      wageRate: emp.wage_rate,
      daysPresent,
      daysInMonth: 26, // statutory working days basis
      otHours,
      pfApplicable: !!emp.uan_encrypted,
      esicApplicable: emp.esic_applicable,
    });

    const [payroll, created] = await Payroll.upsert({
      worker_id: worker.id,
      month,
      year,
      days_present: daysPresent,
      days_in_month: 26,
      ot_hours: otHours,
      daily_wage: calc.dailyWage,
      basic_wage: calc.basicWage,
      ot_amount: calc.otAmount,
      gross: calc.gross,
      pf_applicable: calc.pfApplicable,
      pf_deduction: calc.pfDeduction,
      esic_applicable: calc.esicApplicable,
      esic_deduction: calc.esicDeduction,
      net_pay: calc.netPay,
      generated_at: new Date(),
      generated_by: generatedBy,
    }, { conflictFields: ['worker_id', 'month', 'year'] });

    results.push({ worker_id: worker.id, name: worker.name, ...calc });
  }

  return results;
}

module.exports = { generateMonthlyPayroll };
