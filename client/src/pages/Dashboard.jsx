import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.js';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend } from 'recharts';

const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#a855f7', '#ef4444', '#64748b', '#0ea5e9'];
const PERIODS = ['day', 'week', 'month', 'year'];

export default function Dashboard() {
  const { t } = useTranslation();
  const [stats, setStats] = useState(null);
  const [period, setPeriod] = useState('month');
  const [kind, setKind] = useState('');
  const [deptId, setDeptId] = useState('');
  const [depts, setDepts] = useState([]);

  useEffect(() => { api('/departments').then(setDepts).catch(() => {}); }, []);
  useEffect(() => {
    const qs = new URLSearchParams({ period });
    if (kind) qs.set('kind', kind);
    if (deptId) qs.set('department_id', deptId);
    setStats(null);
    api(`/events/stats?${qs}`).then(setStats).catch(() => {});
  }, [period, kind, deptId]);

  if (!stats) return <div className="card">{t('common.loading')}</div>;

  const total = stats.totals.reduce((s, x) => s + x.n, 0);
  const get = (s) => stats.totals.find(x => x.status === s)?.n || 0;
  const lost = get('lost') + get('stolen');
  const pieData = stats.totals.map(x => ({ ...x, label: t(`ptxStatus.${x.status}`, x.status) }));
  const kindData = stats.byKind.map(x => ({ ...x, label: t(`kind.${x.kind}`, x.kind) }));

  return (
    <div>
      <div className="card" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select value={period} onChange={e => setPeriod(e.target.value)}>
          {PERIODS.map(p => <option key={p} value={p}>{t(`dashboard.period.${p}`)}</option>)}
        </select>
        <select value={kind} onChange={e => setKind(e.target.value)}>
          <option value="">{t('inventory.allKinds')}</option>
          {['IT', 'OT', 'BUSINESS'].map(k => <option key={k} value={k}>{t(`kind.${k}`)}</option>)}
        </select>
        <select value={deptId} onChange={e => setDeptId(e.target.value)}>
          <option value="">{t('inventory.allDepartments')}</option>
          {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      <div className="grid cols-4">
        <div className="card kpi"><div className="value">{total}</div><div className="label">{t('dashboard.totalAssets')}</div></div>
        <div className="card kpi"><div className="value">{get('in_use')}</div><div className="label">{t('dashboard.inUse')}</div></div>
        <div className="card kpi"><div className="value">{get('defective') + get('repair')}</div><div className="label">{t('dashboard.defectiveRepair')}</div></div>
        <div className="card kpi"><div className="value">{lost}</div><div className="label">{t('dashboard.lostStolen')}</div></div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>{t('dashboard.assetsByKind')}</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={kindData}>
              <XAxis dataKey="label" /><YAxis /><Tooltip /><Legend />
              <Bar dataKey="n" name={t('dashboard.total')} fill="#2563eb" />
              <Bar dataKey="in_use" name={t('dashboard.inUse')} fill="#22c55e" />
              <Bar dataKey="repair" name={t('ptxStatus.repair')} fill="#f59e0b" />
              <Bar dataKey="lost" name={t('dashboard.lostStolen')} fill="#ef4444" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <h3>{t('dashboard.statusSplit')}</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={pieData} dataKey="n" nameKey="label" outerRadius={90} label>
                {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>{t('dashboard.assetsByDept')}</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={stats.byDeptAssets}>
              <XAxis dataKey="department" /><YAxis /><Tooltip />
              <Bar dataKey="n" name={t('dashboard.total')} fill="#0ea5e9" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <h3>{t('dashboard.eventsByDept')}</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={stats.byDept}>
              <XAxis dataKey="department" /><YAxis /><Tooltip />
              <Bar dataKey="events" fill="#2563eb" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <h3>{t('dashboard.dailyActivity')}</h3>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={stats.daily}>
            <XAxis dataKey="day" /><YAxis /><Tooltip />
            <Line type="monotone" dataKey="events" stroke="#2563eb" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <h3>{t('dashboard.byCategory')}</h3>
        <table>
          <thead><tr><th>{t('inventory.category')}</th><th>{t('inventory.kindShort')}</th><th>{t('dashboard.total')}</th></tr></thead>
          <tbody>
            {stats.byCategory.map((c, i) => (
              <tr key={i}><td>{c.category}</td><td>{t(`kind.${c.kind}`, c.kind)}</td><td>{c.n}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      {stats.lowStock.length > 0 && (
        <div className="card alert-warn">
          <h3>{t('dashboard.lowStock')}</h3>
          <table>
            <thead><tr><th>{t('inventory.code')}</th><th>{t('inventory.category')}</th><th>{t('common.department')}</th><th>{t('inventory.stock')}</th></tr></thead>
            <tbody>
              {stats.lowStock.map((s, i) => (
                <tr key={i}><td>{s.asset_code}</td><td>{s.category_name}</td><td>{s.department_name || '-'}</td><td>{s.quantity} / min {s.min_quantity}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
