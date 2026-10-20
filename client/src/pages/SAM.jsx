import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, currentUser } from '../lib/api.js';

const METRICS = ['named_user', 'device', 'core', 'subscription'];
const pct = u => (u === null || u === undefined ? '-' : `${Math.round(u * 100)} %`);

export default function SAM() {
  const { t, i18n } = useTranslation();
  const user = currentUser();
  // Format des montants selon la langue CHOISIE dans l'appli (pas celle du navigateur) :
  // un utilisateur belge avec un navigateur anglais doit voir "14 730 EUR" en francais.
  const locale = { fr: 'fr-BE', nl: 'nl-BE' }[(i18n.language || 'en').slice(0, 2)] || 'en-IE';
  const eur = n => (n ?? 0).toLocaleString(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  // Meme regle que l'API : lecture pour tous, ecriture admin/manager (le serveur reste l'autorite).
  const canEdit = user?.role === 'admin' || user?.role === 'manager';

  const [summary, setSummary] = useState(null);
  const [position, setPosition] = useState([]);
  const [renewals, setRenewals] = useState([]);
  const [agents, setAgents] = useState([]);
  const [assets, setAssets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState('product');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const [pForm, setPForm] = useState({ name: '', vendor: '', metric: 'named_user', category: '' });
  const [eForm, setEForm] = useState({ product_id: '', quantity: '', annual_cost: '', contract_ref: '', renewal_date: '' });
  const [iForm, setIForm] = useState({ product_id: '', target: '' });

  const loadAll = () => Promise.all([
    api('/sam/summary').then(setSummary),
    api('/sam/position').then(setPosition),
    api('/sam/renewals?days=90').then(setRenewals),
  ]);
  const loadDetail = id => api(`/sam/products/${id}`).then(setDetail);

  useEffect(() => { loadAll(); api('/agents').then(setAgents); api('/assets').then(setAssets); }, []);
  useEffect(() => { if (selectedId) loadDetail(selectedId); else setDetail(null); }, [selectedId]);

  const run = async (fn, after) => {
    setError(''); setMsg('');
    try { await fn(); await loadAll(); if (selectedId) await loadDetail(selectedId); after?.(); setMsg(t('sam.added')); }
    catch (e) { setError(e.message); }
  };

  const addProduct = () => run(
    () => api('/sam/products', { method: 'POST', body: { ...pForm, category: pForm.category || null } }),
    () => setPForm({ name: '', vendor: '', metric: 'named_user', category: '' }),
  );
  const addEntitlement = () => run(
    () => api('/sam/entitlements', { method: 'POST', body: {
      product_id: Number(eForm.product_id), quantity: Number(eForm.quantity), annual_cost: Number(eForm.annual_cost || 0),
      contract_ref: eForm.contract_ref || null, renewal_date: eForm.renewal_date || null } }),
    () => setEForm({ product_id: '', quantity: '', annual_cost: '', contract_ref: '', renewal_date: '' }),
  );
  const installProduct = position.find(p => String(p.id) === String(iForm.product_id));
  const installTargets = installProduct && ['device', 'core'].includes(installProduct.metric) ? 'asset' : 'agent';
  const assign = () => run(
    () => api('/sam/installations', { method: 'POST', body: {
      product_id: Number(iForm.product_id), [installTargets === 'asset' ? 'asset_id' : 'agent_id']: Number(iForm.target) } }),
    () => setIForm({ ...iForm, target: '' }),
  );
  const release = id => run(() => api(`/sam/installations/${id}`, { method: 'DELETE' }));
  const removeEntitlement = id => run(() => api(`/sam/entitlements/${id}`, { method: 'DELETE' }));

  const gapColor = g => (g < 0 ? '#b91c1c' : g === 0 ? 'var(--text-muted)' : '#166534');
  const Kpi = ({ id, value, label, sub }) => (
    <div className="card kpi">
      <div className="value" data-testid={id}>{value}</div>
      <div className="label">{label}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );

  return (
    <div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t('sam.title')}</h2>
        <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>{t('sam.intro')}</div>
      </div>

      {summary && (
        <div className="grid cols-4" style={{ marginBottom: 16 }}>
          <Kpi id="kpi-cost" value={eur(summary.annual_cost)} label={t('sam.kpiCost')} />
          <Kpi id="kpi-util" value={pct(summary.utilisation)} label={t('sam.kpiUtil')} />
          <Kpi id="kpi-savings" value={eur(summary.savings_identified)} label={t('sam.kpiSavings')} sub={t('sam.kpiSavingsSub', { n: summary.releasable_licences })} />
          <Kpi id="kpi-exposures" value={summary.exposures} label={t('sam.kpiExposures')} sub={summary.exposures ? t('sam.kpiExposuresSub', { amount: eur(summary.exposure_amount) }) : ''} />
          <Kpi id="kpi-renewals" value={summary.renewals_90d} label={t('sam.kpiRenewals')} sub={eur(summary.renewals_90d_amount)} />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(300px, 1fr)', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t('sam.position')}</h3>
          {position.length === 0
            ? <div style={{ color: 'var(--text-muted)', padding: 12 }}>{t('sam.empty')}</div>
            : <table>
                <thead><tr>
                  <th>{t('sam.colProduct')}</th><th>{t('sam.colMetric')}</th><th>{t('sam.colEntitled')}</th>
                  <th>{t('sam.colConsumed')}</th><th>{t('sam.colGap')}</th><th>{t('sam.colUtil')}</th><th>{t('sam.colStatus')}</th>
                </tr></thead>
                <tbody>{position.map(p => (
                  <tr key={p.id} data-testid="sam-row" className={`selectable${p.id === selectedId ? ' selected' : ''}`} onClick={() => setSelectedId(p.id)}>
                    <td>{p.name}<div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.vendor}</div></td>
                    <td>{t(`sam.metric_${p.metric}`)}</td>
                    <td>{p.entitled}</td>
                    <td>{p.consumed}</td>
                    <td style={{ color: gapColor(p.gap), fontWeight: 600 }}>{p.gap > 0 ? `+${p.gap}` : p.gap}</td>
                    <td>{pct(p.utilisation)}</td>
                    <td><span className={`badge ${p.status}`}>{t(`sam.st_${p.status}`)}</span></td>
                  </tr>
                ))}</tbody>
              </table>}
        </div>

        <div className="card" data-testid="sam-detail">
          <h3 style={{ marginTop: 0 }}>{t('sam.detail')}</h3>
          {!detail
            ? <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>{t('sam.selectHint')}</div>
            : <>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{detail.name}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {detail.vendor} | {t(`sam.metric_${detail.metric}`)} | {t(detail.counted_by === 'agent' ? 'sam.countedByAgent' : 'sam.countedByAsset')}
                </div>

                <h4 style={{ marginBottom: 6 }}>{t('sam.entitlements')}</h4>
                {detail.entitlements.length === 0
                  ? <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('sam.noEntitlements')}</div>
                  : <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{detail.entitlements.map(e => (
                      <li key={e.id} data-testid="ent-row" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ flex: 1 }}>
                          <b>{e.quantity}</b> x {eur(e.quantity ? e.annual_cost / e.quantity : 0)} <small style={{ color: 'var(--text-muted)' }}>{t('sam.unitCost')}</small>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{[e.contract_ref, e.renewal_date].filter(Boolean).join(' | ')}</div>
                        </span>
                        {canEdit && <button onClick={() => removeEntitlement(e.id)} style={{ padding: '2px 8px', fontSize: 12 }}>x</button>}
                      </li>))}</ul>}

                <h4 style={{ marginBottom: 6 }}>{t('sam.installations')} ({detail.installations.length})</h4>
                {detail.installations.length === 0
                  ? <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('sam.noInstallations')}</div>
                  : <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 220, overflowY: 'auto' }}>{detail.installations.map(i => (
                      <li key={i.id} data-testid="inst-row" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ flex: 1 }}>{i.agent_name || i.asset_code}</span>
                        {canEdit && <button onClick={() => release(i.id)} style={{ padding: '2px 8px', fontSize: 12 }}>{t('sam.release')}</button>}
                      </li>))}</ul>}
              </>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, marginTop: 16, alignItems: 'start' }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t('sam.renewals')}</h3>
          {renewals.length === 0
            ? <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>{t('sam.noRenewals')}</div>
            : <table>
                <thead><tr><th>{t('sam.colProduct')}</th><th>{t('sam.colDate')}</th><th>{t('sam.colCost')}</th></tr></thead>
                <tbody>{renewals.map(r => (
                  <tr key={r.id} data-testid="renewal-row"><td>{r.product_name}</td><td>{r.renewal_date}</td><td>{eur(r.annual_cost)}</td></tr>
                ))}</tbody>
              </table>}
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t('sam.manage')}</h3>
          {!canEdit
            ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('sam.readOnly')}</div>
            : <>
                <div className="tabs">
                  {['product', 'entitlement', 'install'].map(k => (
                    <button key={k} data-testid={`tab-${k}`} className={tab === k ? 'active' : ''} onClick={() => { setTab(k); setError(''); setMsg(''); }}>
                      {t(`sam.tab${k[0].toUpperCase()}${k.slice(1)}`)}
                    </button>
                  ))}
                </div>

                {tab === 'product' && (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <input placeholder={t('sam.name')} value={pForm.name} onChange={e => setPForm({ ...pForm, name: e.target.value })} />
                    <input placeholder={t('sam.vendor')} value={pForm.vendor} onChange={e => setPForm({ ...pForm, vendor: e.target.value })} />
                    <select value={pForm.metric} onChange={e => setPForm({ ...pForm, metric: e.target.value })} aria-label={t('sam.metric')}>
                      {METRICS.map(m => <option key={m} value={m}>{t(`sam.metric_${m}`)}</option>)}
                    </select>
                    <input placeholder={t('sam.category')} value={pForm.category} onChange={e => setPForm({ ...pForm, category: e.target.value })} />
                    <button data-testid="btn-add-product" onClick={addProduct} disabled={!pForm.name.trim() || !pForm.vendor.trim()}>{t('sam.addProduct')}</button>
                  </div>)}

                {tab === 'entitlement' && (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <select value={eForm.product_id} onChange={e => setEForm({ ...eForm, product_id: e.target.value })} aria-label={t('sam.product')}>
                      <option value="">{t('sam.chooseProduct')}</option>
                      {position.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <input type="number" min="0" placeholder={t('sam.quantity')} value={eForm.quantity} onChange={e => setEForm({ ...eForm, quantity: e.target.value })} />
                    <input type="number" min="0" placeholder={t('sam.annualCost')} value={eForm.annual_cost} onChange={e => setEForm({ ...eForm, annual_cost: e.target.value })} />
                    <input placeholder={t('sam.contractRef')} value={eForm.contract_ref} onChange={e => setEForm({ ...eForm, contract_ref: e.target.value })} />
                    <input type="date" aria-label={t('sam.renewalDate')} value={eForm.renewal_date} onChange={e => setEForm({ ...eForm, renewal_date: e.target.value })} />
                    <button data-testid="btn-add-entitlement" onClick={addEntitlement} disabled={!eForm.product_id || eForm.quantity === ''}>{t('sam.addEntitlement')}</button>
                  </div>)}

                {tab === 'install' && (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <select value={iForm.product_id} onChange={e => setIForm({ product_id: e.target.value, target: '' })} aria-label={t('sam.product')}>
                      <option value="">{t('sam.chooseProduct')}</option>
                      {position.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <select value={iForm.target} onChange={e => setIForm({ ...iForm, target: e.target.value })} disabled={!iForm.product_id} data-testid="install-target">
                      <option value="">{installTargets === 'asset' ? t('sam.chooseAsset') : t('sam.chooseAgent')}</option>
                      {installTargets === 'asset'
                        ? assets.map(a => <option key={a.id} value={a.id}>{a.asset_code}</option>)
                        : agents.map(a => <option key={a.id} value={a.id}>{a.first_name} {a.last_name}</option>)}
                    </select>
                    <button data-testid="btn-assign" onClick={assign} disabled={!iForm.product_id || !iForm.target}>{t('sam.assign')}</button>
                  </div>)}

                {error && <div className="error" data-testid="sam-error" style={{ marginTop: 8 }}>{error}</div>}
                {msg && <div data-testid="sam-msg" style={{ marginTop: 8, fontSize: 13, color: 'var(--success-text)' }}>{msg}</div>}
              </>}
        </div>
      </div>
    </div>
  );
}
