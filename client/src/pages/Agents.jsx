import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.js';

export default function Agents() {
  const { t } = useTranslation();
  const [agents, setAgents] = useState([]);
  const [q, setQ] = useState('');
  const [depts, setDepts] = useState([]);
  const [form, setForm] = useState({ first_name: '', last_name: '', matricule: '', department_id: '' });
  const [error, setError] = useState('');

  const load = () => api(`/agents${q ? `?q=${encodeURIComponent(q)}` : ''}`).then(setAgents);
  useEffect(() => { load(); api('/departments').then(setDepts); }, [q]);

  const add = async () => {
    setError('');
    // Avant : aucune gestion d'erreur. Un matricule en double (409) ou un champ manquant (400) levait
    // une exception non rattrapee et l'ecran n'affichait strictement rien.
    try {
      await api('/agents', { method: 'POST', body: { ...form, department_id: form.department_id || null } });
      setForm({ first_name: '', last_name: '', matricule: '', department_id: '' });
      load();
    } catch (e) { setError(e.message); }
  };

  return (
    <div>
      <div className="card">
        <h2>{t('agents.addTitle')}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) auto', gap: 8 }}>
          <input placeholder={t('common.firstName')} value={form.first_name} onChange={e => setForm({ ...form, first_name: e.target.value })} />
          <input placeholder={t('common.lastName')} value={form.last_name} onChange={e => setForm({ ...form, last_name: e.target.value })} />
          <input placeholder={t('common.badge')} value={form.matricule} onChange={e => setForm({ ...form, matricule: e.target.value })} />
          <select value={form.department_id} onChange={e => setForm({ ...form, department_id: e.target.value })}>
            <option value="">{t('agents.departmentPlaceholder')}</option>
            {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button onClick={add}>{t('common.add')}</button>
        </div>
        {error && <div className="error" data-testid="agent-error" style={{ marginTop: 8 }}>{error}</div>}
      </div>
      <div className="card">
        <input placeholder={t('agents.searchPlaceholder')} value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 12, width: 300 }} />
        <table>
          <thead>
            <tr>
              <th>{t('common.badge')}</th><th>{t('common.lastName')}</th>
              <th>{t('common.firstName')}</th><th>{t('common.department')}</th>
            </tr>
          </thead>
          <tbody>{agents.map(a => (
            <tr key={a.id}><td>{a.matricule || '-'}</td><td>{a.last_name}</td><td>{a.first_name}</td><td>{a.department_name || '-'}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
