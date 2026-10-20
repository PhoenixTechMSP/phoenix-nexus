import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { api, currentUser } from '../lib/api.js';
import { Html5Qrcode } from 'html5-qrcode';

export default function Scan() {
  const { t } = useTranslation();
  const user = currentUser();
  const canManage = user?.role === 'admin' || user?.role === 'manager';
  const [code, setCode] = useState('');
  const [asset, setAsset] = useState(null);
  const [assetList, setAssetList] = useState([]);
  const [agents, setAgents] = useState([]);
  const [agentQuery, setAgentQuery] = useState('');
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [returnStatus, setReturnStatus] = useState('available');
  const [notes, setNotes] = useState('');
  const [qty, setQty] = useState(1);
  const [ticket, setTicket] = useState('');
  const [vendor, setVendor] = useState('');
  const [msg, setMsg] = useState(null);
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef(null);

  const refreshList = () => api('/assets').then(setAssetList).catch(() => {});
  useEffect(() => { refreshList(); }, []);
  useEffect(() => {
    if (agentQuery.length < 2) return setAgents([]);
    api(`/agents?q=${encodeURIComponent(agentQuery)}`).then(setAgents).catch(() => {});
  }, [agentQuery]);

  const lookup = async (raw) => {
    setMsg(null);
    if (!raw) return;
    try {
      setAsset(await api(`/assets/lookup/${encodeURIComponent(raw)}`));
    } catch (e) { setMsg({ type: 'error', text: e.message }); setAsset(null); }
  };

  const startScan = async () => {
    setScanning(true);
    const scanner = new Html5Qrcode('qr-reader');
    scannerRef.current = scanner;
    await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: 250 }, (text) => {
      scanner.stop().then(() => setScanning(false));
      setCode(text); lookup(text);
    });
  };
  const stopScan = () => { scannerRef.current?.stop().then(() => setScanning(false)); };

  const reset = () => {
    setCode(''); setAsset(null); setSelectedAgent(null); setAgentQuery('');
    setNotes(''); setQty(1); setTicket(''); setVendor(''); refreshList();
  };

  const act = async (path, body, success) => {
    try {
      await api(`/assets/${encodeURIComponent(asset.asset_code)}/${path}`, { method: 'POST', body });
      setMsg({ type: 'success', text: success });
      reset();
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
  };

  const checkOut = () => {
    if (!asset || !selectedAgent) return setMsg({ type: 'error', text: t('scan.needBoth') });
    act('check-out', { agent_id: selectedAgent.id, notes },
      t('scan.outDone', { ptx: asset.asset_code, agent: `${selectedAgent.first_name} ${selectedAgent.last_name}` }));
  };
  const checkIn = () => act('check-in', { status: returnStatus, notes },
    t('scan.inDone', { ptx: asset.asset_code, status: t(`ptxStatus.${returnStatus}`, returnStatus) }));
  const consume = () => act('consume', { quantity: Number(qty), agent_id: selectedAgent?.id || null, notes },
    t('scan.consumeDone', { qty, code: asset.asset_code }));
  const restock = () => act('restock', { quantity: Number(qty), notes },
    t('scan.restockDone', { qty, code: asset.asset_code }));
  const repairSend = () => act('repair-send', { repair_ticket: ticket, repair_vendor: vendor, notes },
    t('scan.repairSent', { code: asset.asset_code }));
  const repairReturn = () => act('repair-return', { status: returnStatus === 'in_use' ? 'available' : returnStatus, notes },
    t('scan.repairReturned', { code: asset.asset_code }));

  const suggestions = code.length >= 2 && !asset
    ? assetList.filter(a =>
      a.asset_code.toLowerCase().includes(code.toLowerCase()) ||
      (a.serial || '').toLowerCase().includes(code.toLowerCase()) ||
      (a.label || '').toLowerCase().includes(code.toLowerCase())).slice(0, 8)
    : [];

  const isConsumable = !!asset?.consumable;

  return (
    <div>
      <div className="card">
        <h2>{t('scan.title')}</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input placeholder={t('scan.placeholder')} value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => e.key === 'Enter' && lookup(code)} style={{ flex: 1 }} />
          <button onClick={() => lookup(code)}>{t('scan.lookup')}</button>
          {!scanning
            ? <button onClick={startScan} className="secondary">📷 {t('scan.camera')}</button>
            : <button onClick={stopScan} className="danger">{t('scan.stop')}</button>}
        </div>
        {suggestions.length > 0 && (
          <div className="suggestions">
            {suggestions.map(a => (
              <button key={a.id} onClick={() => { setCode(a.asset_code); lookup(a.asset_code); }}>
                <strong>{a.asset_code}</strong> - {a.label || a.serial || '-'} <em>{a.category_name}</em>{' '}
                <span className={`badge ${a.status}`}>{t(`ptxStatus.${a.status}`, a.status)}</span>
              </button>
            ))}
          </div>
        )}
        <div id="qr-reader" style={{ maxWidth: 400, display: scanning ? 'block' : 'none' }}></div>
      </div>

      {msg && <div className="card" style={{ background: msg.type === 'error' ? '#fee2e2' : '#dcfce7' }}>{msg.text}</div>}

      {asset && (
        <div className="card">
          <h3>{asset.asset_code} <span className={`badge ${asset.status}`}>{t(`ptxStatus.${asset.status}`, asset.status)}</span></h3>
          <p>
            <strong>{t('inventory.category')}:</strong> {asset.category_name} ({asset.category_kind ? t(`kind.${asset.category_kind}`) : '-'})
            {asset.serial && <> · <strong>{t('inventory.serial')}:</strong> {asset.serial}</>}
            {asset.department_name && <> · <strong>{t('common.department')}:</strong> {asset.department_name}</>}
          </p>
          {asset.agent_name && <p><strong>{t('scan.currentHolder')}:</strong> {asset.agent_name} ({asset.agent_matricule || '-'})</p>}

          {isConsumable ? (
            <>
              <h4>{t('scan.stockOps')} - {t('inventory.stock')}: {asset.quantity}</h4>
              <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} style={{ width: 120 }} />
              <input placeholder={t('scan.agentSearch')} value={agentQuery} onChange={e => { setSelectedAgent(null); setAgentQuery(e.target.value); }} style={{ width: '100%', marginTop: 8 }} />
              {agents.length > 0 && !selectedAgent && (
                <div className="suggestions">
                  {agents.map(a => (
                    <button key={a.id} onClick={() => { setSelectedAgent(a); setAgentQuery(`${a.first_name} ${a.last_name}`); }}>
                      {a.last_name.toUpperCase()} {a.first_name} - {a.matricule || '-'} <em>{a.department_name}</em>
                    </button>
                  ))}
                </div>
              )}
              <textarea placeholder={t('common.notes')} value={notes} onChange={e => setNotes(e.target.value)} style={{ width: '100%', marginTop: 8 }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={consume}>{t('scan.consume')}</button>
                {canManage && <button className="secondary" onClick={restock}>{t('scan.restock')}</button>}
              </div>
            </>
          ) : (
            <>
              {asset.status === 'available' && (
                <>
                  <h4>{t('scan.checkOut')}</h4>
                  <input placeholder={t('scan.agentSearch')} value={agentQuery} onChange={e => { setSelectedAgent(null); setAgentQuery(e.target.value); }} style={{ width: '100%' }} />
                  {agents.length > 0 && !selectedAgent && (
                    <div className="suggestions">
                      {agents.map(a => (
                        <button key={a.id} onClick={() => { setSelectedAgent(a); setAgentQuery(`${a.first_name} ${a.last_name}`); }}>
                          {a.last_name.toUpperCase()} {a.first_name} - {a.matricule || '-'} <em>{a.department_name}</em>
                        </button>
                      ))}
                    </div>
                  )}
                  <textarea placeholder={t('common.notes')} value={notes} onChange={e => setNotes(e.target.value)} style={{ width: '100%', marginTop: 8 }} />
                  <button onClick={checkOut} disabled={!selectedAgent} style={{ marginTop: 8 }}>{t('scan.confirmOut')}</button>
                </>
              )}

              {asset.status === 'in_use' && (
                <>
                  <h4>{t('scan.checkIn')}</h4>
                  <select value={returnStatus} onChange={e => setReturnStatus(e.target.value)}>
                    <option value="available">{t('scan.returnOk')}</option>
                    <option value="defective">{t('ptxStatus.defective')}</option>
                    <option value="lost">{t('ptxStatus.lost')}</option>
                    <option value="stolen">{t('ptxStatus.stolen')}</option>
                  </select>
                  <textarea placeholder={t('common.notes')} value={notes} onChange={e => setNotes(e.target.value)} style={{ width: '100%', marginTop: 8 }} />
                  <button onClick={checkIn} style={{ marginTop: 8 }}>{t('scan.confirmIn')}</button>
                </>
              )}

              {canManage && asset.status !== 'repair' && (
                <>
                  <h4>{t('scan.sendRepair')}</h4>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input placeholder={t('scan.ticket')} value={ticket} onChange={e => setTicket(e.target.value)} />
                    <input placeholder={t('scan.vendor')} value={vendor} onChange={e => setVendor(e.target.value)} />
                    <button className="secondary" onClick={repairSend}>{t('scan.confirmRepair')}</button>
                  </div>
                </>
              )}

              {canManage && asset.status === 'repair' && (
                <>
                  <h4>{t('scan.repairReturn')}</h4>
                  <p><small>{t('scan.ticket')}: {asset.repair_ticket || '-'} · {asset.repair_vendor || '-'}</small></p>
                  <select value={returnStatus} onChange={e => setReturnStatus(e.target.value)}>
                    <option value="available">{t('scan.returnOk')}</option>
                    <option value="defective">{t('ptxStatus.defective')}</option>
                    <option value="retired">{t('ptxStatus.retired')}</option>
                  </select>
                  <textarea placeholder={t('common.notes')} value={notes} onChange={e => setNotes(e.target.value)} style={{ width: '100%', marginTop: 8 }} />
                  <button onClick={repairReturn} style={{ marginTop: 8 }}>{t('scan.confirmRepairReturn')}</button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
