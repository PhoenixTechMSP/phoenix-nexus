import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, downloadBlob } from '../lib/api.js';

export default function Logs() {
  const { t } = useTranslation();
  const [events, setEvents] = useState([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kind, setKind] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [deptId, setDeptId] = useState('');
  const [categories, setCategories] = useState([]);
  const [depts, setDepts] = useState([]);

  useEffect(() => {
    Promise.all([api('/categories'), api('/departments')])
      .then(([c, d]) => { setCategories(c); setDepts(d); }).catch(() => {});
  }, []);

  const params = () => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    if (kind) qs.set('kind', kind);
    if (categoryId) qs.set('category_id', categoryId);
    if (deptId) qs.set('department_id', deptId);
    return qs;
  };

  const load = () => api(`/events?${params()}`).then(setEvents).catch(() => {});
  useEffect(() => { load(); }, []);

  return (
    <div className="card">
      <h2>{t('logs.title')}</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <input type="date" value={to} onChange={e => setTo(e.target.value)} />
        <select value={kind} onChange={e => setKind(e.target.value)}>
          <option value="">{t('inventory.allKinds')}</option>
          {['IT', 'OT', 'BUSINESS'].map(k => <option key={k} value={k}>{t(`kind.${k}`)}</option>)}
        </select>
        <select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
          <option value="">{t('inventory.allCategories')}</option>
          {categories.filter(c => !kind || c.kind === kind).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={deptId} onChange={e => setDeptId(e.target.value)}>
          <option value="">{t('inventory.allDepartments')}</option>
          {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button onClick={load}>{t('common.filter')}</button>
        <button className="secondary" onClick={() => downloadBlob(`/events/export.xlsx?${params()}`, 'asset-logs.xlsx')}>{t('logs.exportLogs')}</button>
        <button className="secondary" onClick={() => downloadBlob('/events/fleet-export.xlsx', 'phoenix-nexus-inventory.xlsx')}>{t('logs.exportFleet')}</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>{t('common.date')}</th><th>{t('inventory.code')}</th><th>{t('inventory.category')}</th>
            <th>{t('logs.event')}</th><th>{t('common.status')}</th><th>{t('inventory.quantity')}</th>
            <th>{t('common.agent')}</th><th>{t('common.department')}</th><th>{t('logs.operator')}</th>
          </tr>
        </thead>
        <tbody>
          {events.map(e => (
            <tr key={e.id}>
              <td>{new Date(e.created_at).toLocaleString()}</td>
              <td>{e.asset_code}{e.serial ? <><br /><small>{e.serial}</small></> : null}</td>
              <td>{e.category_name || '-'}{e.category_kind ? ` (${t(`kind.${e.category_kind}`, e.category_kind)})` : ''}</td>
              <td>{t(`eventType.${e.event_type}`, e.event_type)}</td>
              <td><span className={`badge ${e.status_after || ''}`}>{e.status_after ? t(`ptxStatus.${e.status_after}`, e.status_after) : '-'}</span></td>
              <td>{e.quantity ?? '-'}</td>
              <td>{e.agent_name || '-'}</td>
              <td>{e.department_name || '-'}</td>
              <td>{e.operator_name || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
