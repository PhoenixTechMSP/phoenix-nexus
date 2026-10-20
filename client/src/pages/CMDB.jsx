import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, currentUser } from '../lib/api.js';

export default function CMDB() {
  const { t } = useTranslation();
  const user = currentUser();
  // Meme regle que cote API (routes/cmdb.js) : lecture pour tous, ecriture admin/manager.
  // Le serveur reste l'autorite : ceci ne fait que masquer des boutons inutiles.
  const canEdit = user?.role === 'admin' || user?.role === 'manager';

  const [items, setItems] = useState([]);
  const [depts, setDepts] = useState([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [relForm, setRelForm] = useState({ target: '', type: '' });
  const [error, setError] = useState('');

  const loadItems = () => api('/cmdb/items').then(setItems);
  const loadDetail = id => api(`/cmdb/items/${id}`).then(setDetail);

  useEffect(() => { loadItems(); api('/departments').then(setDepts); }, []);
  useEffect(() => {
    setError('');
    setRelForm({ target: '', type: '' });
    if (selectedId) loadDetail(selectedId); else setDetail(null);
  }, [selectedId]);

  const deptName = id => depts.find(d => d.id === id)?.name || '-';

  const counts = useMemo(() => ({
    total: items.length,
    active: items.filter(i => i.status === 'Active').length,
    archived: items.filter(i => i.status === 'Archived').length,
  }), [items]);

  const shown = items.filter(i =>
    (!status || i.status === status) &&
    (!q || i.label.toLowerCase().includes(q.toLowerCase()))
  );

  const addRelationship = async () => {
    setError('');
    try {
      await api('/cmdb/relationships', {
        method: 'POST',
        body: { source_ci_id: detail.id, target_ci_id: Number(relForm.target), relationship_type: relForm.type.trim() },
      });
      setRelForm({ target: '', type: '' });
      loadDetail(detail.id);
    } catch (e) { setError(e.message); }
  };

  const removeRelationship = async relId => {
    setError('');
    try {
      await api(`/cmdb/relationships/${relId}`, { method: 'DELETE' });
      loadDetail(detail.id);
    } catch (e) { setError(e.message); }
  };

  const statusBadge = s => (
    <span className={`badge ${s === 'Active' ? 'available' : 'archived'}`}>
      {t(`cmdb.${s === 'Active' ? 'statusActive' : 'statusArchived'}`)}
    </span>
  );
  const classBadge = c => (
    <span className={`badge ${(c || 'Nominative').toLowerCase()}`}>{t(`cmdb.class${c || 'Nominative'}`)}</span>
  );

  const RelList = ({ rows, labelKey, typeKey, canRemove }) => (
    rows.length === 0
      ? <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('cmdb.noRel')}</div>
      : <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map(r => (
            <li key={r.id} data-testid="rel-row" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <code>{r.relationship_type}</code>
              <span style={{ flex: 1 }}>{r[labelKey]} <small style={{ color: 'var(--text-muted)' }}>({r[typeKey]})</small></span>
              {canRemove && <button onClick={() => removeRelationship(r.id)} style={{ padding: '2px 8px', fontSize: 12 }}>{t('cmdb.remove')}</button>}
            </li>
          ))}
        </ul>
  );

  return (
    <div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t('cmdb.title')}</h2>
        <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>{t('cmdb.intro')}</div>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="card kpi"><div className="value" data-testid="kpi-total">{counts.total}</div><div className="label">{t('cmdb.total')}</div></div>
        <div className="card kpi"><div className="value" data-testid="kpi-active">{counts.active}</div><div className="label">{t('cmdb.active')}</div></div>
        <div className="card kpi"><div className="value" data-testid="kpi-archived">{counts.archived}</div><div className="label">{t('cmdb.archived')}</div></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(300px, 1fr)', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <input placeholder={t('cmdb.search')} value={q} onChange={e => setQ(e.target.value)} style={{ width: 280 }} />
            <select value={status} onChange={e => setStatus(e.target.value)} aria-label={t('cmdb.filterStatus')}>
              <option value="">{t('cmdb.all')}</option>
              <option value="Active">{t('cmdb.active')}</option>
              <option value="Archived">{t('cmdb.archived')}</option>
            </select>
          </div>
          {shown.length === 0
            ? <div style={{ color: 'var(--text-muted)', padding: 12 }}>{t('cmdb.empty')}</div>
            : <table>
                <thead>
                  <tr>
                    <th>{t('cmdb.colLabel')}</th><th>{t('cmdb.colType')}</th><th>{t('cmdb.colClass')}</th>
                    <th>{t('cmdb.colStatus')}</th><th>{t('cmdb.colDept')}</th><th>{t('cmdb.colUpdated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(i => (
                    <tr key={i.id} data-testid="ci-row" className={`selectable${i.id === selectedId ? ' selected' : ''}`} onClick={() => setSelectedId(i.id)}>
                      <td>{i.label}</td>
                      <td>{i.ci_type}</td>
                      <td>{classBadge(i.equipment_class)}</td>
                      <td>{statusBadge(i.status)}</td>
                      <td>{deptName(i.department_id)}</td>
                      <td>{(i.updated_at || '').slice(0, 16)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>}
        </div>

        <div className="card" data-testid="ci-detail">
          <h3 style={{ marginTop: 0 }}>{t('cmdb.detail')}</h3>
          {!detail
            ? <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>{t('cmdb.selectHint')}</div>
            : <>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{detail.label}</div>
                <div style={{ display: 'flex', gap: 6, margin: '8px 0', flexWrap: 'wrap' }}>
                  {statusBadge(detail.status)} {classBadge(detail.equipment_class)}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {t('cmdb.colSource')}: {detail.source_system} #{detail.source_identifier} | {t('cmdb.colDept')}: {deptName(detail.department_id)}
                </div>
                {detail.status === 'Archived' && <div style={{ fontSize: 13, marginTop: 8 }}>{t('cmdb.archivedNote')}</div>}

                <h4 style={{ marginBottom: 6 }}>{t('cmdb.outgoing')}</h4>
                <RelList rows={detail.relationships || []} labelKey="target_label" typeKey="target_type" canRemove={canEdit} />

                <h4 style={{ marginBottom: 6 }}>{t('cmdb.incoming')}</h4>
                <RelList rows={detail.incoming || []} labelKey="source_label" typeKey="source_type" canRemove={canEdit} />

                {canEdit
                  ? <div style={{ marginTop: 16 }}>
                      <h4 style={{ marginBottom: 6 }}>{t('cmdb.addRel')}</h4>
                      <div style={{ display: 'grid', gap: 8 }}>
                        <select value={relForm.target} onChange={e => setRelForm({ ...relForm, target: e.target.value })} aria-label={t('cmdb.target')}>
                          <option value="">{t('cmdb.chooseTarget')}</option>
                          {items.filter(i => i.id !== detail.id).map(i => <option key={i.id} value={i.id}>{i.label}</option>)}
                        </select>
                        <input placeholder={t('cmdb.relType')} value={relForm.type} onChange={e => setRelForm({ ...relForm, type: e.target.value })} />
                        <button onClick={addRelationship} disabled={!relForm.target || !relForm.type.trim()}>{t('cmdb.add')}</button>
                      </div>
                    </div>
                  : <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)' }}>{t('cmdb.readOnly')}</div>}
                {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
              </>}
        </div>
      </div>
    </div>
  );
}
