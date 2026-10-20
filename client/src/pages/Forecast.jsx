import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.js';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';

const RANGES = [30, 60, 90, 180];

export default function Forecast() {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [days, setDays] = useState(60);
  const [kind, setKind] = useState('');
  const [deptId, setDeptId] = useState('');
  const [depts, setDepts] = useState([]);

  useEffect(() => { api('/departments').then(setDepts).catch(() => {}); }, []);
  useEffect(() => {
    const qs = new URLSearchParams({ days });
    if (kind) qs.set('kind', kind);
    if (deptId) qs.set('department_id', deptId);
    setData(null);
    api(`/events/forecast?${qs}`).then(setData).catch(() => {});
  }, [days, kind, deptId]);

  if (!data) return <div className="card">{t('common.loading')}</div>;

  const weekdays = [0, 1, 2, 3, 4, 5, 6].map(w => ({
    weekday: w,
    label: t(`forecast.weekday.${w}`),
    n: data.byWeekday.find(x => x.weekday === w)?.n || 0,
  }));
  const hours = Array.from({ length: 24 }, (_, h) => ({
    label: `${String(h).padStart(2, '0')}h`,
    n: data.byHour.find(x => x.hour === h)?.n || 0,
  }));
  const growth = data.weekly_growth_pct;
  const gaps = data.capacity.filter(c => c.gap > 0);

  return (
    <div>
      <div className="card" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select value={days} onChange={e => setDays(Number(e.target.value))}>
          {RANGES.map(r => <option key={r} value={r}>{t('forecast.lastDays', { days: r })}</option>)}
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
        <div className="card kpi">
          <div className="value">{data.sample_size}</div>
          <div className="label">{t('forecast.checkOuts')}</div>
        </div>
        <div className="card kpi">
          <div className="value">{data.peak_hour === null ? '-' : `${String(data.peak_hour).padStart(2, '0')}h`}</div>
          <div className="label">{t('forecast.peakHour')}</div>
        </div>
        <div className="card kpi">
          <div className="value">{data.peak_weekday === null ? '-' : t(`forecast.weekday.${data.peak_weekday}`)}</div>
          <div className="label">{t('forecast.peakDay')}</div>
        </div>
        <div className="card kpi">
          <div className="value">{growth > 0 ? `+${growth}%` : `${growth}%`}</div>
          <div className="label">{t('forecast.weeklyTrend')}</div>
        </div>
      </div>

      {data.sample_size < 20 && (
        <div className="card"><small>{t('forecast.lowData')}</small></div>
      )}

      <div className="grid cols-2">
        <div className="card">
          <h3>{t('forecast.byHour')}</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={hours}>
              <XAxis dataKey="label" interval={1} /><YAxis /><Tooltip />
              <Bar dataKey="n" name={t('forecast.checkOuts')} fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <h3>{t('forecast.byWeekday')}</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={weekdays}>
              <XAxis dataKey="label" /><YAxis /><Tooltip />
              <Bar dataKey="n" name={t('forecast.checkOuts')} fill="#0ea5e9" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <h3>{t('forecast.weeklyVolume')}</h3>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={data.weekly}>
            <XAxis dataKey="week" /><YAxis /><Tooltip /><Legend />
            <Line type="monotone" dataKey="n" name={t('forecast.checkOuts')} stroke="#a855f7" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <h3>{t('forecast.capacityTitle')}</h3>
        <p><small>{t('forecast.capacityHelp')}</small></p>
        <table>
          <thead>
            <tr>
              <th>{t('common.department')}</th>
              <th>{t('forecast.usable')}</th>
              <th>{t('forecast.avgDaily')}</th>
              <th>{t('forecast.peakDaily')}</th>
              <th>{t('forecast.utilisation')}</th>
              <th>{t('forecast.projected')}</th>
              <th>{t('forecast.recommended')}</th>
              <th>{t('forecast.gap')}</th>
            </tr>
          </thead>
          <tbody>
            {data.capacity.map(c => (
              <tr key={c.department_id}>
                <td>{c.department}</td>
                <td>{c.usable} / {c.total}</td>
                <td>{c.avg_daily}</td>
                <td>{c.peak_daily}</td>
                <td>{c.utilisation === null ? '-' : `${c.utilisation}%`}</td>
                <td>{c.projected_peak}</td>
                <td>{c.recommended}</td>
                <td>{c.gap > 0 ? <strong style={{ color: '#ef4444' }}>+{c.gap}</strong> : '0'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {gaps.length > 0 && (
        <div className="card">
          <h3>{t('forecast.actionTitle')}</h3>
          <ul>
            {gaps.map(c => (
              <li key={c.department_id}>
                {t('forecast.actionLine', { dept: c.department, gap: c.gap, peak: c.projected_peak })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
