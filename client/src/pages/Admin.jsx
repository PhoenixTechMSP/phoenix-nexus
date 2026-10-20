import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.js';
import ImportWizard from '../components/ImportWizard.jsx';

function Imports() {
  const { t } = useTranslation();
  return (
    <>
      <div className="card">
        <h2>{t('import.guided')}</h2>
        <p><small>{t('import.guidedHint')}</small></p>
      </div>
      <ImportWizard target="assets" title={t('import.assets')} />
      <ImportWizard target="assets" title={t('import.ptx')} defaults={{ category: 'PTX' }} />
      <ImportWizard target="agents" title={t('import.agents')} />
    </>
  );
}

function Categories() {
  const { t } = useTranslation();
  const [cats, setCats] = useState([]);
  const [form, setForm] = useState({ code: '', name: '', kind: 'IT', consumable: false });
  const [error, setError] = useState('');

  const load = () => api('/categories').then(setCats).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault(); setError('');
    try {
      await api('/categories', { method: 'POST', body: { ...form, consumable: form.consumable ? 1 : 0 } });
      setForm({ code: '', name: '', kind: 'IT', consumable: false });
      load();
    } catch (e) { setError(e.message); }
  };
  const patch = async (id, body) => {
    try { await api('/categories/' + id, { method: 'PATCH', body }); load(); }
    catch (e) { setError(e.message); }
  };
  const remove = async (c) => {
    if (!confirm(t('admin.confirmDeleteCategory', { name: c.name }))) return;
    try { await api('/categories/' + c.id, { method: 'DELETE' }); load(); }
    catch (e) { setError(e.message); }
  };

  return (
    <>
      <div className="card">
        <h2>{t('admin.newCategory')}</h2>
        <form onSubmit={create} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          <input placeholder={t('admin.categoryCode')} required value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} />
          <input placeholder={t('common.name')} required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
            {['IT', 'OT', 'BUSINESS'].map(k => <option key={k} value={k}>{t(`kind.${k}`)}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={form.consumable} onChange={e => setForm({ ...form, consumable: e.target.checked })} />
            {t('admin.consumable')}
          </label>
          <button type="submit">{t('common.add')}</button>
        </form>
      </div>
      {error && <div className="card" style={{ background: '#fee2e2' }}>{error}</div>}
      <div className="card">
        <h2>{t('admin.categoriesTitle')} ({cats.length})</h2>
        <table>
          <thead><tr>
            <th>{t('admin.categoryCode')}</th><th>{t('common.name')}</th><th>{t('inventory.kindShort')}</th>
            <th>{t('admin.consumable')}</th><th>{t('admin.assets')}</th><th>{t('common.actions')}</th>
          </tr></thead>
          <tbody>
            {cats.map(c => (
              <tr key={c.id}>
                <td><strong>{c.code}</strong></td>
                <td>{c.name}</td>
                <td>
                  <select value={c.kind} onChange={e => patch(c.id, { kind: e.target.value })}>
                    {['IT', 'OT', 'BUSINESS'].map(k => <option key={k} value={k}>{t(`kind.${k}`)}</option>)}
                  </select>
                </td>
                <td>
                  <input type="checkbox" checked={!!c.consumable} onChange={e => patch(c.id, { consumable: e.target.checked ? 1 : 0 })} />
                </td>
                <td>{c.asset_count}</td>
                <td><button onClick={() => remove(c)} style={{ color: '#b91c1c' }}>{t('common.delete')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Departments() {
  const { t } = useTranslation();
  const [depts, setDepts] = useState([]);
  const [form, setForm] = useState({ code: '', name: '' });
  const [error, setError] = useState('');

  const load = () => api('/departments').then(setDepts).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault(); setError('');
    try { await api('/departments', { method: 'POST', body: form }); setForm({ code: '', name: '' }); load(); }
    catch (e) { setError(e.message); }
  };
  const patch = async (id, body) => {
    try { await api('/departments/' + id, { method: 'PATCH', body }); load(); }
    catch (e) { setError(e.message); }
  };
  const remove = async (d) => {
    if (!confirm(t('admin.confirmDeleteDepartment', { name: d.name }))) return;
    try { await api('/departments/' + d.id, { method: 'DELETE' }); load(); }
    catch (e) { setError(e.message); }
  };

  return (
    <>
      <div className="card">
        <h2>{t('admin.newDepartment')}</h2>
        <form onSubmit={create} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <input placeholder={t('admin.departmentCode')} required value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} />
          <input placeholder={t('common.name')} required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <button type="submit">{t('common.add')}</button>
        </form>
      </div>
      {error && <div className="card" style={{ background: '#fee2e2' }}>{error}</div>}
      <div className="card">
        <h2>{t('admin.departmentsTitle')} ({depts.length})</h2>
        <table>
          <thead><tr><th>{t('admin.departmentCode')}</th><th>{t('common.name')}</th><th>{t('common.actions')}</th></tr></thead>
          <tbody>
            {depts.map(d => (
              <tr key={d.id}>
                <td><strong>{d.code}</strong></td>
                <td>
                  <input defaultValue={d.name} onBlur={e => e.target.value !== d.name && patch(d.id, { name: e.target.value })} />
                </td>
                <td><button onClick={() => remove(d)} style={{ color: '#b91c1c' }}>{t('common.delete')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Users() {
  const { t } = useTranslation();
  const [users, setUsers] = useState([]);
  const [depts, setDepts] = useState([]);
  const [form, setForm] = useState({ email: '', full_name: '', role: 'staff', department_id: '', password: '' });
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [u, d] = await Promise.all([api('/users'), api('/departments')]);
      setUsers(u); setDepts(d);
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault(); setError('');
    try {
      await api('/users', { method: 'POST', body: { ...form, department_id: form.department_id || null } });
      setForm({ email: '', full_name: '', role: 'staff', department_id: '', password: '' });
      await load();
    } catch (e) { setError(e.message); }
  };

  const patch = async (id, body) => {
    try { await api('/users/' + id, { method: 'PATCH', body }); await load(); }
    catch (e) { setError(e.message); }
  };

  const remove = async (u) => {
    if (!confirm(t('admin.confirmDelete', { email: u.email }))) return;
    try { await api('/users/' + u.id, { method: 'DELETE' }); await load(); }
    catch (e) { setError(e.message); }
  };

  const resetPwd = async (u) => {
    const p = prompt(t('admin.resetPassword') + ' - ' + u.email);
    if (p) patch(u.id, { password: p });
  };

  return (
    <>
      <div className="card">
        <h2>{t('admin.newUser')}</h2>
        <form onSubmit={create} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <input placeholder={t('common.email')} type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          <input placeholder={t('common.name')} required value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />
          <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
            <option value="admin">{t('roles.admin')}</option>
            <option value="manager">{t('roles.manager')}</option>
            <option value="staff">{t('roles.staff')}</option>
            <option value="pending">{t('roles.pending')}</option>
          </select>
          <select value={form.department_id} onChange={e => setForm({ ...form, department_id: e.target.value })}>
            <option value="">- {t('common.department')} -</option>
            {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <input placeholder={t('admin.password')} type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
          <button type="submit">{t('common.add')}</button>
        </form>
      </div>

      {error && <div className="card" style={{ background: '#fee2e2' }}>{error}</div>}

      <div className="card">
        <h2>{t('admin.usersTitle')} ({users.length})</h2>
        <table>
          <thead><tr>
            <th>{t('common.email')}</th><th>{t('common.name')}</th><th>{t('common.role')}</th>
            <th>{t('common.department')}</th><th>{t('common.status')}</th><th>SSO</th><th>{t('common.actions')}</th>
          </tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.full_name}</td>
                <td>
                  <select value={u.role} onChange={e => patch(u.id, { role: e.target.value })}>
                    <option value="admin">{t('roles.admin')}</option>
                    <option value="manager">{t('roles.manager')}</option>
                    <option value="staff">{t('roles.staff')}</option>
                    <option value="pending">{t('roles.pending')}</option>
                  </select>
                </td>
                <td>
                  <select value={u.department_id || ''} onChange={e => patch(u.id, { department_id: e.target.value || null })}>
                    <option value="">-</option>
                    {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </td>
                <td>
                  <select value={u.status} onChange={e => patch(u.id, { status: e.target.value })}>
                    <option value="active">{t('status.active')}</option>
                    <option value="disabled">{t('status.disabled')}</option>
                    <option value="pending">{t('status.pending')}</option>
                  </select>
                </td>
                <td>{u.oid ? '✓' : '-'}</td>
                <td>
                  <button onClick={() => resetPwd(u)}>{t('admin.resetPassword')}</button>{' '}
                  <button onClick={() => remove(u)} style={{ color: '#b91c1c' }}>{t('common.delete')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function Admin() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('users');
  const tabs = [
    ['users', t('admin.tabs.users')],
    ['categories', t('admin.tabs.categories')],
    ['departments', t('admin.tabs.departments')],
    ['imports', t('admin.tabs.imports')],
  ];
  return (
    <div>
      <div className="tabs">
        {tabs.map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'users' && <Users />}
      {tab === 'categories' && <Categories />}
      {tab === 'departments' && <Departments />}
      {tab === 'imports' && <Imports />}
    </div>
  );
}
