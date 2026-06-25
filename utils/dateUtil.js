/**
 * Returns today's date as YYYY-MM-DD in the server's local timezone.
 *
 * Do NOT use `new Date().toISOString().split('T')[0]` for this — toISOString()
 * converts to UTC first, which rolls the date back by one day for any
 * positive-UTC-offset timezone (e.g. IST) during the early-morning hours
 * before the UTC date catches up to the local date.
 */
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

module.exports = { todayLocal };
