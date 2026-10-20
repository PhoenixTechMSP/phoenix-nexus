import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import XLSX from 'xlsx';

export const eventsRouter = Router();
eventsRouter.use(requireAuth);

const EVENT_SELECT = `
  SELECT e.*, a.asset_code, a.serial, a.label,
    c.code AS category_code, c.name AS category_name, c.kind AS category_kind,
    ag.first_name || ' ' || ag.last_name AS agent_name, ag.matricule,
    d.name AS department_name, u.full_name AS operator_name
  FROM asset_events e
  LEFT JOIN assets a ON a.id = e.asset_id
  LEFT JOIN categories c ON c.id = COALESCE(e.category_id, a.category_id)
  LEFT JOIN agents ag ON ag.id = e.agent_id
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN users u ON u.id = e.user_id
`;

function eventFilters(q) {
  const where = [], params = [];
  if (q.from) { where.push('e.created_at >= ?'); params.push(q.from); }
  if (q.to) { where.push('e.created_at <= ?'); params.push(q.to.length === 10 ? q.to + ' 23:59:59' : q.to); }
  if (q.department_id) { where.push('e.department_id = ?'); params.push(q.department_id); }
  if (q.category_id) { where.push('COALESCE(e.category_id, a.category_id) = ?'); params.push(q.category_id); }
  if (q.kind) { where.push('c.kind = ?'); params.push(q.kind); }
  if (q.asset_id) { where.push('e.asset_id = ?'); params.push(q.asset_id); }
  return { clause: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

eventsRouter.get('/', (req, res) => {
  const { clause, params } = eventFilters(req.query);
  const limit = Number(req.query.limit || 500);
  res.json(db.prepare(`${EVENT_SELECT} ${clause} ORDER BY e.created_at DESC LIMIT ?`).all(...params, limit));
});

eventsRouter.get('/export.xlsx', (req, res) => {
  const { clause, params } = eventFilters(req.query);
  const rows = db.prepare(`${EVENT_SELECT} ${clause} ORDER BY e.created_at DESC`).all(...params).map(r => ({
    Date: r.created_at, Asset: r.asset_code, Serial: r.serial, Label: r.label,
    Category: r.category_name, Type: r.category_kind, Event: r.event_type,
    Status: r.status_after, Quantity: r.quantity, Agent: r.agent_name,
    Matricule: r.matricule, Department: r.department_name, Operator: r.operator_name, Notes: r.notes,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Logs');
  send(res, wb, `asset-logs-${new Date().toISOString().slice(0, 10)}.xlsx`);
});

function send(res, wb, filename) {
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
}

// Live aggregated CMDB snapshot: one row per asset + summaries per status,
// department, category and asset kind (IT / OT / business).
eventsRouter.get('/fleet-export.xlsx', (req, res) => {
  const inventory = db.prepare(`
    SELECT a.asset_code AS "Asset", a.serial AS "Serial / IMEI", a.label AS "Label",
      c.name AS "Category", c.kind AS "Type", a.status AS "Status",
      a.quantity AS "Qty", a.min_quantity AS "Min qty", a.location AS "Location",
      d.name AS "Department", ag.first_name || ' ' || ag.last_name AS "Current holder",
      ag.matricule AS "Matricule", a.repair_ticket AS "Repair ticket", a.repair_vendor AS "Vendor",
      a.repair_sent_at AS "Sent to repair", a.repair_returned_at AS "Returned from repair",
      a.repair_notes AS "Repair notes", u.full_name AS "Last operator",
      a.last_status_change_at AS "Last status change", a.notes AS "Notes", a.updated_at AS "Updated"
    FROM assets a
    LEFT JOIN categories c ON c.id = a.category_id
    LEFT JOIN departments d ON d.id = a.department_id
    LEFT JOIN agents ag ON ag.id = a.current_agent_id
    LEFT JOIN users u ON u.id = a.last_operator_id
    ORDER BY c.kind, c.name, a.asset_code
  `).all();

  const byStatus = db.prepare(`SELECT status AS "Status", COUNT(*) AS "Count" FROM assets GROUP BY status ORDER BY status`).all();

  const statusCols = `
    SUM(CASE WHEN a.status='available' THEN 1 ELSE 0 END) AS "Available",
    SUM(CASE WHEN a.status='in_use' THEN 1 ELSE 0 END) AS "In use",
    SUM(CASE WHEN a.status='defective' THEN 1 ELSE 0 END) AS "Defective",
    SUM(CASE WHEN a.status='repair' THEN 1 ELSE 0 END) AS "In repair",
    SUM(CASE WHEN a.status='lost' THEN 1 ELSE 0 END) AS "Lost",
    SUM(CASE WHEN a.status='stolen' THEN 1 ELSE 0 END) AS "Stolen",
    SUM(CASE WHEN a.status='retired' THEN 1 ELSE 0 END) AS "Retired",
    COUNT(*) AS "Total"`;

  const byDept = db.prepare(`
    SELECT COALESCE(d.name,'-') AS "Department", ${statusCols}
    FROM assets a LEFT JOIN departments d ON d.id = a.department_id
    GROUP BY d.id ORDER BY d.name`).all();

  const byCategory = db.prepare(`
    SELECT COALESCE(c.name,'-') AS "Category", COALESCE(c.kind,'-') AS "Type", ${statusCols}
    FROM assets a LEFT JOIN categories c ON c.id = a.category_id
    GROUP BY c.id ORDER BY c.kind, c.name`).all();

  const byKind = db.prepare(`
    SELECT COALESCE(c.kind,'-') AS "Type", ${statusCols}
    FROM assets a LEFT JOIN categories c ON c.id = a.category_id
    GROUP BY c.kind ORDER BY c.kind`).all();

  const consumables = db.prepare(`
    SELECT a.asset_code AS "Item", c.name AS "Category", d.name AS "Department",
      a.quantity AS "Stock", a.min_quantity AS "Min", a.location AS "Location",
      CASE WHEN a.quantity <= a.min_quantity THEN 'REORDER' ELSE '' END AS "Alert"
    FROM assets a
    JOIN categories c ON c.id = a.category_id AND c.consumable = 1
    LEFT JOIN departments d ON d.id = a.department_id
    ORDER BY a.quantity`).all();

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byKind), 'Summary by type');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byStatus), 'Summary by status');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byDept), 'Summary by department');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byCategory), 'Summary by category');
  if (consumables.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(consumables), 'Consumables stock');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(inventory), 'Inventory');
  send(res, wb, `phoenix-nexus-inventory-${new Date().toISOString().slice(0, 10)}.xlsx`);
});

// JSON snapshot for dashboards / auto-refresh tables
eventsRouter.get('/fleet-snapshot', (req, res) => {
  const inventory = db.prepare(`
    SELECT a.id, a.asset_code, a.serial, a.label, a.status, a.quantity, a.min_quantity,
      c.code AS category_code, c.name AS category_name, c.kind AS category_kind, c.consumable,
      d.name AS department_name, ag.first_name || ' ' || ag.last_name AS agent_name,
      a.repair_ticket, a.repair_vendor, a.repair_sent_at, a.repair_returned_at,
      u.full_name AS last_operator_name, a.last_status_change_at, a.updated_at
    FROM assets a
    LEFT JOIN categories c ON c.id = a.category_id
    LEFT JOIN departments d ON d.id = a.department_id
    LEFT JOIN agents ag ON ag.id = a.current_agent_id
    LEFT JOIN users u ON u.id = a.last_operator_id
    ORDER BY a.asset_code
  `).all();
  const summary = db.prepare(`SELECT status, COUNT(*) AS n FROM assets GROUP BY status`).all();
  res.json({ generated_at: new Date().toISOString(), summary, inventory, fleet: inventory });
});

// Reporting: day / week / month / year, per department, category and asset type
eventsRouter.get('/stats', (req, res) => {
  const { period = 'month', department_id, category_id, kind } = req.query;
  const since = { day: "-1 days", week: "-7 days", month: "-30 days", year: "-365 days" }[period] || "-30 days";
  const where = [`e.created_at >= date('now', ?)`], params = [since];
  if (department_id) { where.push('e.department_id = ?'); params.push(department_id); }
  if (category_id) { where.push('COALESCE(e.category_id, a.category_id) = ?'); params.push(category_id); }
  if (kind) { where.push('c.kind = ?'); params.push(kind); }
  const clause = 'WHERE ' + where.join(' AND ');
  const joins = `FROM asset_events e
    LEFT JOIN assets a ON a.id = e.asset_id
    LEFT JOIN categories c ON c.id = COALESCE(e.category_id, a.category_id)`;

  const totals = db.prepare(`SELECT status, COUNT(*) AS n FROM assets GROUP BY status`).all();

  const byKind = db.prepare(`
    SELECT COALESCE(c.kind,'-') AS kind, COUNT(*) AS n,
      SUM(CASE WHEN a.status='in_use' THEN 1 ELSE 0 END) AS in_use,
      SUM(CASE WHEN a.status='defective' THEN 1 ELSE 0 END) AS defective,
      SUM(CASE WHEN a.status='repair' THEN 1 ELSE 0 END) AS repair,
      SUM(CASE WHEN a.status IN ('lost','stolen') THEN 1 ELSE 0 END) AS lost
    FROM assets a LEFT JOIN categories c ON c.id = a.category_id GROUP BY c.kind ORDER BY c.kind`).all();

  const byCategory = db.prepare(`
    SELECT COALESCE(c.name,'-') AS category, COALESCE(c.kind,'-') AS kind, COUNT(*) AS n
    FROM assets a LEFT JOIN categories c ON c.id = a.category_id GROUP BY c.id ORDER BY n DESC`).all();

  const byDeptAssets = db.prepare(`
    SELECT COALESCE(d.name,'-') AS department, COUNT(*) AS n
    FROM assets a LEFT JOIN departments d ON d.id = a.department_id GROUP BY d.id ORDER BY n DESC`).all();

  const byDept = db.prepare(`
    SELECT COALESCE(d.name,'-') AS department, COUNT(e.id) AS events
    ${joins} LEFT JOIN departments d ON d.id = e.department_id
    ${clause} GROUP BY d.id ORDER BY events DESC`).all(...params);

  const daily = db.prepare(`
    SELECT date(e.created_at) AS day, COUNT(*) AS events
    ${joins} ${clause} GROUP BY day ORDER BY day`).all(...params);

  const lowStock = db.prepare(`
    SELECT a.asset_code, a.label, c.name AS category_name, a.quantity, a.min_quantity,
      d.name AS department_name
    FROM assets a JOIN categories c ON c.id = a.category_id AND c.consumable = 1
    LEFT JOIN departments d ON d.id = a.department_id
    WHERE a.quantity <= a.min_quantity ORDER BY a.quantity LIMIT 50`).all();

  res.json({ period, totals, byKind, byCategory, byDept, byDeptAssets, daily, lowStock });
});

// ---------------------------------------------------------------------------
// Predictive view: usage peaks (hour of day, weekday), weekly trend and
// capacity gap per department based on real check-out history.
// ---------------------------------------------------------------------------
eventsRouter.get('/forecast', (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days || 60), 14), 365);
  const kind = req.query.kind || null;
  const departmentId = req.query.department_id || null;

  const where = [`e.event_type = 'check_out'`, `e.created_at >= date('now', ?)`];
  const params = [`-${days} days`];
  if (kind) { where.push('c.kind = ?'); params.push(kind); }
  if (departmentId) { where.push('e.department_id = ?'); params.push(departmentId); }
  const clause = 'WHERE ' + where.join(' AND ');
  const joins = `FROM asset_events e
    LEFT JOIN assets a ON a.id = e.asset_id
    LEFT JOIN categories c ON c.id = COALESCE(e.category_id, a.category_id)`;

  const byHour = db.prepare(`
    SELECT CAST(strftime('%H', e.created_at) AS INTEGER) AS hour, COUNT(*) AS n
    ${joins} ${clause} GROUP BY hour ORDER BY hour`).all(...params);

  const byWeekday = db.prepare(`
    SELECT CAST(strftime('%w', e.created_at) AS INTEGER) AS weekday, COUNT(*) AS n
    ${joins} ${clause} GROUP BY weekday ORDER BY weekday`).all(...params);

  const daily = db.prepare(`
    SELECT date(e.created_at) AS day, COUNT(*) AS n
    ${joins} ${clause} GROUP BY day ORDER BY day`).all(...params);

  const weekly = db.prepare(`
    SELECT strftime('%Y-W%W', e.created_at) AS week, COUNT(*) AS n
    ${joins} ${clause} GROUP BY week ORDER BY week`).all(...params);

  const perDeptDaily = db.prepare(`
    SELECT COALESCE(d.id, 0) AS department_id, COALESCE(d.name, '-') AS department,
      date(e.created_at) AS day, COUNT(*) AS n
    ${joins} LEFT JOIN departments d ON d.id = e.department_id
    ${clause} GROUP BY COALESCE(d.id, 0), date(e.created_at)`).all(...params);   // pas de GROUP BY sur l'alias : department_id est aussi une colonne de e et a (ambigu)

  const fleetRows = db.prepare(`
    SELECT COALESCE(d.id, 0) AS department_id, COALESCE(d.name, '-') AS department,
      SUM(CASE WHEN a.status IN ('available','in_use') THEN 1 ELSE 0 END) AS usable,
      COUNT(*) AS total
    FROM assets a
    LEFT JOIN departments d ON d.id = a.department_id
    LEFT JOIN categories c ON c.id = a.category_id
    WHERE COALESCE(c.consumable, 0) = 0 ${kind ? 'AND c.kind = ?' : ''}
    GROUP BY COALESCE(d.id, 0)`).all(...(kind ? [kind] : []));

  const percentile = (arr, p) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  };
  // Least-squares slope over an ordered series (units per step)
  const slope = (values) => {
    const n = values.length;
    if (n < 3) return 0;
    const mx = (n - 1) / 2;
    const my = values.reduce((s, v) => s + v, 0) / n;
    let num = 0, den = 0;
    values.forEach((v, i) => { num += (i - mx) * (v - my); den += (i - mx) ** 2; });
    return den ? num / den : 0;
  };

  const grouped = new Map();
  for (const r of perDeptDaily) {
    const key = String(r.department_id);
    if (!grouped.has(key)) grouped.set(key, { department: r.department, series: [] });
    grouped.get(key).series.push(r.n);
  }

  const weeklyValues = weekly.map(w => w.n);
  const weeklySlope = slope(weeklyValues);
  const weeklyAvg = weeklyValues.length ? weeklyValues.reduce((s, v) => s + v, 0) / weeklyValues.length : 0;
  const growth = weeklyAvg ? weeklySlope / weeklyAvg : 0; // relative growth per week

  const capacity = fleetRows.map(f => {
    const g = grouped.get(String(f.department_id));
    const series = g?.series || [];
    const peak = series.length ? Math.max(...series) : 0;
    const p95 = percentile(series, 0.95);
    const avg = series.length ? series.reduce((s, v) => s + v, 0) / series.length : 0;
    // Projected peak demand in 4 weeks, plus a 10% safety buffer
    const projected = Math.ceil(Math.max(peak, p95) * (1 + Math.max(-0.5, Math.min(1, growth * 4))));
    const recommended = Math.ceil(projected * 1.1);
    return {
      department_id: f.department_id, department: f.department,
      usable: f.usable, total: f.total,
      avg_daily: Math.round(avg * 10) / 10, peak_daily: peak, p95_daily: p95,
      projected_peak: projected, recommended,
      gap: Math.max(0, recommended - f.usable),
      utilisation: f.usable ? Math.round((Math.max(peak, p95) / f.usable) * 100) : null,
    };
  }).sort((x, y) => y.gap - x.gap || y.peak_daily - x.peak_daily);

  const peakHour = byHour.reduce((b, r) => (!b || r.n > b.n ? r : b), null);
  const peakWeekday = byWeekday.reduce((b, r) => (!b || r.n > b.n ? r : b), null);

  res.json({
    days, kind, department_id: departmentId,
    generated_at: new Date().toISOString(),
    sample_size: daily.reduce((s, d) => s + d.n, 0),
    byHour, byWeekday, daily, weekly,
    weekly_growth_pct: Math.round(growth * 1000) / 10,
    peak_hour: peakHour?.hour ?? null,
    peak_weekday: peakWeekday?.weekday ?? null,
    capacity,
  });
});
