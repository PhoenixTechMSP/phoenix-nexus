import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, currentUser } from '../lib/api.js';

const STATUSES = ['available', 'in_use', 'defective', 'repair', 'lost', 'stolen', 'retired'];
const KINDS = ['IT', 'OT', 'BUSINESS'];
const emptyForm = {
  asset_code: '', serial: '', label: '', category_id: '', department_id: '',
  status: 'available', quantity: 1, min_quantity: 0, location: '', notes: '',
};

export default function Inventory() {
  const { t } = useTranslation();
  const user = currentUser();
  const canEdit = user?.role === 'admin' || user?.role === 'manager';
  const [assets, setAssets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [depts, setDepts] = useState([]);
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [deptId, setDeptId] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editError, setEditError] = useState('');
  const [error, setError] = useState('');


  const load = async () => {
    const [a, c, d] = await Promise.all([api('/assets'), api('/categories'), api('/departments')]);
    setAssets(a); setCategories(c); setDepts(d);
  };
  useEffect(() => { load().catch(e => setError(e.message)); }, []);

  const filtered = assets.filter(a =>
    (!status || a.status === status) &&
    (!kind || a.category_kind === kind) &&
    (!categoryId || String(a.category_id) === String(categoryId)) &&
    (!deptId || String(a.department_id) === String(deptId)) &&
    (!filter ||
      a.asset_code.toLowerCase().includes(filter.toLowerCase()) ||
      (a.serial || '').toLowerCase().includes(filter.toLowerCase()) ||
      (a.label || '').toLowerCase().includes(filter.toLowerCase()))
  );

  const create = async (e) => {
    e.preventDefault(); setError('');
    try {
      await api('/assets', {
        method: 'POST',
        body: {
          ...form,
          category_id: Number(form.category_id),
          department_id: form.department_id ? Number(form.department_id) : null,
          quantity: Number(form.quantity) || 1,
          min_quantity: Number(form.min_quantity) || 0,
        },
      });
      setForm(emptyForm); setShowForm(false); await load();
    } catch (e) { setError(e.message); }
  };

  const patch = async (id, body) => {
    try { await api('/assets/' + id, { method: 'PATCH', body }); await load(); }
    catch (e) { setError(e.message); }
  };

  const openEdit = (a) => {
    setEditError('');
    setEditing({
      id: a.id, asset_code: a.asset_code, serial: a.serial || '', label: a.label || '',
      category_id: a.category_id || '', department_id: a.department_id || '', status: a.status,
      quantity: a.quantity ?? 1, min_quantity: a.min_quantity ?? 0,
      location: a.location || '', notes: a.notes || '',
    });
  };

  const saveEdit = async (e) => {
    e.preventDefault(); setEditError('');
    try {
      await api('/assets/' + editing.id, {
        method: 'PATCH',
        body: {
          asset_code: editing.asset_code,
          serial: editing.serial,
          label: editing.label,
          category_id: editing.category_id ? Number(editing.category_id) : null,
          department_id: editing.department_id ? Number(editing.department_id) : null,
          status: editing.status,
          quantity: Number(editing.quantity) || 0,
          min_quantity: Number(editing.min_quantity) || 0,
          location: editing.location,
          notes: editing.notes,
        },
      });
      setEditing(null); await load();
    } catch (err) { setEditError(err.message); }
  };



  const remove = async (a) => {
    if (!confirm(t('inventory.confirmDelete', { code: a.asset_code }))) return;
    try { await api('/assets/' + a.id, { method: 'DELETE' }); await load(); }
    catch (e) { setError(e.message); }
  };

  const catsForForm = categories;

  return (
    <div>
      <div className="card">
        <h2>{t('inventory.title', { shown: filtered.length, total: assets.length })}</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input placeholder={t('inventory.filterPlaceholder')} value={filter} onChange={e => setFilter(e.target.value)} />
          <select value={kind} onChange={e => setKind(e.target.value)}>
            <option value="">{t('inventory.allKinds')}</option>
            {KINDS.map(k => <option key={k} value={k}>{t(`kind.${k}`)}</option>)}
          </select>
          <select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
            <option value="">{t('inventory.allCategories')}</option>
            {categories.filter(c => !kind || c.kind === kind).map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select value={deptId} onChange={e => setDeptId(e.target.value)}>
            <option value="">{t('inventory.allDepartments')}</option>
            {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">{t('inventory.allStatuses')}</option>
            {STATUSES.map(s => <option key={s} value={s}>{t(`ptxStatus.${s}`)}</option>)}
          </select>
          {canEdit && (
            <button onClick={() => setShowForm(!showForm)}>
              {showForm ? t('common.cancel') : '+ ' + t('inventory.newAsset')}
            </button>
          )}
        </div>

        {error && <div className="card alert-error">{error}</div>}

        {showForm && canEdit && (
          <form onSubmit={create} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
            <input placeholder={t('inventory.code')} required value={form.asset_code} onChange={e => setForm({ ...form, asset_code: e.target.value })} />
            <input placeholder={t('inventory.serial')} value={form.serial} onChange={e => setForm({ ...form, serial: e.target.value })} />
            <input placeholder={t('inventory.label')} value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} />
            <select required value={form.category_id} onChange={e => setForm({ ...form, category_id: e.target.value })}>
              <option value="">- {t('inventory.category')} -</option>
              {catsForForm.map(c => <option key={c.id} value={c.id}>{t(`kind.${c.kind}`)} · {c.name}</option>)}
            </select>
            <select value={form.department_id} onChange={e => setForm({ ...form, department_id: e.target.value })}>
              <option value="">- {t('common.department')} -</option>
              {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
              {STATUSES.map(s => <option key={s} value={s}>{t(`ptxStatus.${s}`)}</option>)}
            </select>
            <input type="number" min="0" placeholder={t('inventory.quantity')} value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} />
            <input type="number" min="0" placeholder={t('inventory.minQuantity')} value={form.min_quantity} onChange={e => setForm({ ...form, min_quantity: e.target.value })} />
            <input placeholder={t('inventory.location')} value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />
            <input placeholder={t('common.notes')} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} style={{ gridColumn: 'span 2' }} />
            <button type="submit">{t('common.add')}</button>
          </form>
        )}

        <table>
          <thead>
            <tr>
              <th>{t('inventory.code')}</th><th>{t('inventory.serial')}</th><th>{t('inventory.category')}</th>
              <th>{t('inventory.kindShort')}</th><th>{t('common.status')}</th><th>{t('inventory.stock')}</th>
              <th>{t('common.department')}</th><th>{t('common.agent')}</th>
              {canEdit && <th>{t('common.actions')}</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map(a => (
              <tr key={a.id} className={a.consumable && a.quantity <= a.min_quantity ? 'row-warn' : undefined}>
                <td><strong>{a.asset_code}</strong>{a.label ? <><br /><small>{a.label}</small></> : null}</td>
                <td>{a.serial || '-'}</td>
                <td>{a.category_name || '-'}</td>
                <td>{a.category_kind ? t(`kind.${a.category_kind}`) : '-'}</td>
                <td>
                  {canEdit ? (
                    <select value={a.status} onChange={e => patch(a.id, { status: e.target.value })}>
                      {STATUSES.map(s => <option key={s} value={s}>{t(`ptxStatus.${s}`)}</option>)}
                    </select>
                  ) : <span className={`badge ${a.status}`}>{t(`ptxStatus.${a.status}`, a.status)}</span>}
                </td>
                <td>{a.consumable ? `${a.quantity} / min ${a.min_quantity}` : a.quantity}</td>
                <td>
                  {canEdit ? (
                    <select value={a.department_id || ''} onChange={e => patch(a.id, { department_id: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">-</option>
                      {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  ) : (a.department_name || '-')}
                </td>
                <td>{a.agent_name || '-'}</td>
                {canEdit && (
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button onClick={() => openEdit(a)}>{t('common.edit')}</button>
                    {user?.role === 'admin' && (
                      <button onClick={() => remove(a)} style={{ color: 'var(--danger-text)', marginLeft: 6 }}>{t('common.delete')}</button>
                    )}
                  </td>
                )}

              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && canEdit && (
        <div
          onClick={() => setEditing(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 50,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflow: 'auto',
          }}
        >
          <form
            onClick={e => e.stopPropagation()}
            onSubmit={saveEdit}
            className="card"
            style={{ maxWidth: 720, width: '100%' }}
          >
            <h3>{t('inventory.editTitle')} - {editing.asset_code}</h3>
            {editError && <div className="alert-error alert-box" style={{ marginBottom: 8 }}>{editError}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <input placeholder={t('inventory.code')} required value={editing.asset_code} onChange={e => setEditing({ ...editing, asset_code: e.target.value })} />
              <input placeholder={t('inventory.serial')} value={editing.serial} onChange={e => setEditing({ ...editing, serial: e.target.value })} />
              <input placeholder={t('inventory.label')} value={editing.label} onChange={e => setEditing({ ...editing, label: e.target.value })} />
              <select required value={editing.category_id} onChange={e => setEditing({ ...editing, category_id: e.target.value })}>
                <option value="">- {t('inventory.category')} -</option>
                {categories.map(c => <option key={c.id} value={c.id}>{t(`kind.${c.kind}`)} · {c.name}</option>)}
              </select>
              <select value={editing.department_id} onChange={e => setEditing({ ...editing, department_id: e.target.value })}>
                <option value="">- {t('common.department')} -</option>
                {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <select value={editing.status} onChange={e => setEditing({ ...editing, status: e.target.value })}>
                {STATUSES.map(s => <option key={s} value={s}>{t(`ptxStatus.${s}`)}</option>)}
              </select>
              <input type="number" min="0" placeholder={t('inventory.quantity')} value={editing.quantity} onChange={e => setEditing({ ...editing, quantity: e.target.value })} />
              <input type="number" min="0" placeholder={t('inventory.minQuantity')} value={editing.min_quantity} onChange={e => setEditing({ ...editing, min_quantity: e.target.value })} />
              <input placeholder={t('inventory.location')} value={editing.location} onChange={e => setEditing({ ...editing, location: e.target.value })} />
              <input placeholder={t('common.notes')} value={editing.notes} onChange={e => setEditing({ ...editing, notes: e.target.value })} style={{ gridColumn: 'span 3' }} />
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button type="submit">{t('common.save')}</button>
              <button type="button" onClick={() => setEditing(null)}>{t('common.cancel')}</button>
            </div>
          </form>
        </div>
      )}
    </div>

  );
}
