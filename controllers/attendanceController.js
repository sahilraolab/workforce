const { Op } = require('sequelize');
const { Worker, Attendance, Site, EmploymentDetail } = require('../models');
const { scopeWhere } = require('../middlewares/tenantScope');
const { logAudit } = require('../middlewares/auditLogger');
const { Parser } = require('json2csv');
const { todayLocal } = require('../utils/dateUtil');

exports.daily = async (req, res) => {
  const date = req.query.date || todayLocal();
  const siteId = req.query.site_id || req.tenantScope.site_id;

  try {
    const workerWhere = scopeWhere(req, { status: 'active' });
    if (siteId) workerWhere.site_id = siteId;

    const workers = await Worker.findAll({
      where: workerWhere,
      include: [
        { model: Attendance, as: 'attendances', where: { date }, required: false },
        { model: Site, as: 'site', attributes: ['id', 'name'] },
      ],
      order: [['name', 'ASC']],
    });

    const sites = await Site.findAll({
      where: scopeWhere(req, { status: 'active' }, { allowSiteFilter: false }),
      attributes: ['id', 'name'],
    });

    const statusFilter = req.query.status_filter;
    const filteredWorkers = statusFilter
      ? workers.filter(w => {
          const s = w.attendances && w.attendances[0] ? w.attendances[0].status : null;
          if (statusFilter === 'unmarked') return !s;
          return s === statusFilter;
        })
      : workers;

    res.render('attendance/daily', {
      title: 'Daily Attendance',
      workers: filteredWorkers,
      allWorkers: workers,
      date,
      sites,
      selectedSite: siteId,
      query: req.query,
    });
  } catch (err) {
    console.error(err);
    req.flash('error', res.locals.t('err_load_attendance'));
    res.redirect('/dashboard');
  }
};

exports.mark = async (req, res) => {
  const { worker_id, date, status, ot_hours, notes } = req.body;

  try {
    const worker = await Worker.findByPk(worker_id);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });
    const { assertTenantOwnership } = require('../middlewares/tenantScope');
    assertTenantOwnership(worker, req);

    const [att] = await Attendance.upsert({
      worker_id,
      date,
      status,
      ot_hours: parseFloat(ot_hours) || 0,
      notes: notes || null,
      marked_by: req.session.user.id,
      created_by: req.session.user.id,
      updated_by: req.session.user.id,
    }, { conflictFields: ['worker_id', 'date'] });

    res.json({ success: true, status, ot_hours: att.ot_hours, notes: att.notes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mark attendance' });
  }
};

exports.musterRoll = async (req, res) => {
  const month = parseInt(req.query.month || new Date().getMonth() + 1, 10);
  const year = parseInt(req.query.year || new Date().getFullYear(), 10);
  const siteId = req.query.site_id || req.tenantScope.site_id;
  const daysInMonth = new Date(year, month, 0).getDate();

  try {
    const workerWhere = scopeWhere(req, { status: 'active' });
    if (siteId) workerWhere.site_id = siteId;

    const workers = await Worker.findAll({
      where: workerWhere,
      include: [{
        model: Attendance,
        as: 'attendances',
        where: {
          date: {
            [Op.between]: [
              `${year}-${String(month).padStart(2,'0')}-01`,
              `${year}-${String(month).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}`,
            ],
          },
        },
        required: false,
      }],
      order: [['name', 'ASC']],
    });

    // Build attendance map: worker_id → { day: status }
    const attMap = {};
    workers.forEach(w => {
      attMap[w.id] = {};
      (w.attendances || []).forEach(a => {
        const day = new Date(a.date).getDate();
        attMap[w.id][day] = a.status;
      });
    });

    const sites = await Site.findAll({ where: scopeWhere(req, {}, { allowSiteFilter: false }), attributes: ['id', 'name'] });

    if (req.query.export === 'csv') {
      // Build CSV
      const fields = ['Worker', 'Site', ...Array.from({ length: daysInMonth }, (_, i) => `Day ${i+1}`), 'Present', 'Absent', 'Half-Day'];
      const data = workers.map(w => {
        const row = { Worker: w.name, Site: w.site ? w.site.name : '' };
        let present = 0, absent = 0, half = 0;
        for (let d = 1; d <= daysInMonth; d++) {
          const s = attMap[w.id][d] || '';
          row[`Day ${d}`] = s === 'present' ? 'P' : s === 'absent' ? 'A' : s === 'half_day' ? 'H' : '';
          if (s === 'present') present++;
          else if (s === 'absent') absent++;
          else if (s === 'half_day') half++;
        }
        row.Present = present; row.Absent = absent; row['Half-Day'] = half;
        return row;
      });
      const parser = new Parser({ fields });
      const csv = parser.parse(data);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="muster-roll-${year}-${month}.csv"`);
      return res.send(csv);
    }

    // Optional filter: show only workers with at least one occurrence of a status
    const workerFilter = req.query.worker_filter || '';
    const statusMap = { present: 'present', half_day: 'half_day', absent: 'absent' };
    let filteredWorkers = workers;
    if (statusMap[workerFilter]) {
      filteredWorkers = workers.filter(w =>
        Object.values(attMap[w.id] || {}).includes(statusMap[workerFilter])
      );
    } else if (workerFilter === 'unmarked') {
      filteredWorkers = workers.filter(w => {
        for (let d = 1; d <= daysInMonth; d++) {
          if (!attMap[w.id][d]) return true;
        }
        return false;
      });
    }

    res.render('attendance/muster-roll', {
      title: `Muster Roll — ${month}/${year}`,
      workers: filteredWorkers,
      allWorkers: workers,
      attMap,
      month,
      year,
      daysInMonth,
      sites,
      selectedSite: siteId,
      query: req.query,
    });
  } catch (err) {
    console.error(err);
    req.flash('error', res.locals.t('err_load_muster_roll'));
    res.redirect('/attendance');
  }
};

exports.leaveList = async (req, res) => {
  const { LeaveRecord } = require('../models');
  const workerWhere = scopeWhere(req, {});
  const leaves = await LeaveRecord.findAll({
    include: [{ model: Worker, as: 'worker', where: workerWhere }],
    order: [['created_at', 'DESC']],
    limit: 100,
  });
  res.render('attendance/leaves', { title: 'Leave Records', leaves });
};

exports.applyLeave = async (req, res) => {
  const { LeaveRecord } = require('../models');
  const { worker_id, leave_type, from_date, to_date, reason } = req.body;
  try {
    const worker = await Worker.findByPk(worker_id);
    if (!worker) { req.flash('error', res.locals.t('err_worker_not_found')); return res.redirect('back'); }
    const { assertTenantOwnership } = require('../middlewares/tenantScope');
    assertTenantOwnership(worker, req);

    const from = new Date(from_date);
    const to = new Date(to_date);
    const days = Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1;

    await LeaveRecord.create({
      worker_id, leave_type, from_date, to_date, days, reason,
      status: 'pending',
      created_by: req.session.user.id,
    });

    req.flash('success', res.locals.t('ok_leave_applied'));
    res.redirect(`/workers/${worker_id}`);
  } catch (err) {
    console.error(err);
    req.flash('error', res.locals.t('err_apply_leave'));
    res.redirect('back');
  }
};

exports.approveLeave = async (req, res) => {
  const { LeaveRecord } = require('../models');
  try {
    const leave = await LeaveRecord.findByPk(req.params.id, {
      include: [{ model: Worker, as: 'worker' }],
    });
    if (!leave) { req.flash('error', res.locals.t('err_leave_not_found')); return res.redirect('back'); }
    const { assertTenantOwnership } = require('../middlewares/tenantScope');
    assertTenantOwnership(leave.worker, req);

    const action = req.body.action; // 'approve' or 'reject'
    await leave.update({
      status: action === 'approve' ? 'approved' : 'rejected',
      approved_by: req.session.user.id,
      rejection_reason: action === 'reject' ? req.body.reason : null,
      updated_by: req.session.user.id,
    });

    req.flash('success', res.locals.t(action === 'approve' ? 'ok_leave_approved' : 'ok_leave_rejected'));
    res.redirect(`/workers/${leave.worker_id}`);
  } catch (err) {
    console.error(err);
    req.flash('error', res.locals.t('err_update_leave'));
    res.redirect('back');
  }
};
