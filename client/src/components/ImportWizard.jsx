import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadForm } from '../lib/api.js';

const IGNORE = 'ignore';

/** Guided import: pick file → map columns → simulate → import. */
export default function ImportWizard({ target = 'assets', title, defaults = {} }) {
  const { t } = useTranslation();
  const [file, setFile] = useState(null);
  const [meta, setMeta] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const reset = () => { setFile(null); setMeta(null); setMapping(null); setResult(null); setError(''); };

  const pick = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true); setError(''); setResult(null); setMeta(null); setFile(f);
    try {
      const m = await uploadForm(`/import/preview?target=${target}`, f);
      const merged = { ...m.mapping };
      merged.fields = { ...merged.fields };
      merged.onDuplicate = merged.onDuplicate || 'update';
      // Pre-fill fixed values (e.g. category = PTX) when the file has no such column
      for (const [k, v] of Object.entries(defaults)) {
        if (!merged.fields[k] || merged.fields[k].mode === 'ignore') merged.fields[k] = { mode: 'const', value: v };
      }
      setMeta(m); setMapping(merged);

    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const setField = (key, spec) => setMapping(m => ({ ...m, fields: { ...m.fields, [key]: spec } }));

  const send = async (dryRun) => {
    setBusy(true); setError(''); setResult(null);
    try {
      const r = await uploadForm(
        `/import/commit?target=${target}&dryRun=${dryRun ? 1 : 0}`,
        file,
        { mapping: JSON.stringify(mapping) },
      );
      setResult(r);
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const fieldRow = (key) => {
    const spec = mapping.fields[key] || { mode: IGNORE };
    const value = spec.mode === 'const' ? '__const__' : (spec.mode === 'column' ? spec.column : IGNORE);
    return (
      <tr key={key}>
        <td><strong>{t(`import.field.${key}`, key)}</strong></td>
        <td>
          <select
            value={value}
            onChange={(e) => {
              const v = e.target.value;
              if (v === IGNORE) setField(key, { mode: IGNORE });
              else if (v === '__const__') setField(key, { mode: 'const', value: '' });
              else setField(key, { mode: 'column', column: v });
            }}
          >
            <option value={IGNORE}>- {t('import.ignore')} -</option>
            {meta.headers.map(h => <option key={h} value={h}>{h}</option>)}
            <option value="__const__">{t('import.fixedValue')}</option>
          </select>
        </td>
        <td>
          {spec.mode === 'const' && (
            <input
              placeholder={t('import.fixedValue')}
              value={spec.value || ''}
              onChange={e => setField(key, { mode: 'const', value: e.target.value })}
            />
          )}
          {spec.mode === 'column' && (
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
              <input
                type="checkbox"
                checked={!!spec.split}
                onChange={e => setField(key, e.target.checked
                  ? { ...spec, split: { sep: '/', index: 0 } }
                  : { mode: 'column', column: spec.column })}
              />
              {t('import.split')}
              {spec.split && (
                <>
                  <input
                    style={{ width: 40 }}
                    value={spec.split.sep}
                    onChange={e => setField(key, { ...spec, split: { ...spec.split, sep: e.target.value } })}
                  />
                  <select
                    value={spec.split.index}
                    onChange={e => setField(key, { ...spec, split: { ...spec.split, index: Number(e.target.value) } })}
                  >
                    <option value={0}>{t('import.part1')}</option>
                    <option value={1}>{t('import.part2')}</option>
                    <option value={2}>{t('import.part3')}</option>
                  </select>
                </>
              )}
            </label>
          )}
        </td>
        <td style={{ fontSize: 12, color: '#475569' }}>
          {spec.mode === 'column' && meta.preview[0] ? String(meta.preview[0][spec.column] ?? '') : ''}
        </td>
      </tr>
    );
  };

  return (
    <div className="card">
      <h2>{title}</h2>
      <input type="file" accept=".xlsx,.xls,.csv" onChange={pick} disabled={busy} />
      {busy && <p><small>{t('common.loading', 'Loading…')}</small></p>}
      {error && <div style={{ background: '#fee2e2', padding: 8, borderRadius: 6, marginTop: 8 }}>{error}</div>}

      {meta && mapping && (
        <>
          <p><small>
            {t('import.detected', { count: meta.rowCount, columns: meta.headers.join(', ') })}
            {meta.savedProfile ? ` - ${t('import.savedProfile')}` : ''}
          </small></p>

          <table>
            <thead>
              <tr>
                <th>{t('import.targetField')}</th>
                <th>{t('import.fileColumn')}</th>
                <th>{t('import.options')}</th>
                <th>{t('import.example')}</th>
              </tr>
            </thead>
            <tbody>{meta.fields.map(fieldRow)}</tbody>
          </table>

          <div style={{ marginTop: 8 }}>
            <label style={{ fontSize: 12 }}>{t('import.notesExtra')}</label>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {meta.headers.map(h => (
                <label key={h} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={(mapping.notesExtra || []).includes(h)}
                    onChange={e => setMapping(m => ({
                      ...m,
                      notesExtra: e.target.checked
                        ? [...(m.notesExtra || []), h]
                        : (m.notesExtra || []).filter(x => x !== h),
                    }))}
                  />
                  {h}
                </label>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 12, display: 'block' }}><strong>{t('import.duplicateTitle')}</strong></label>
            <select
              value={mapping.onDuplicate || 'update'}
              onChange={e => setMapping(m => ({ ...m, onDuplicate: e.target.value }))}
            >
              <option value="update">{t('import.dupUpdate')}</option>
              <option value="duplicate">{t('import.dupDuplicate')}</option>
              <option value="skip">{t('import.dupSkip')}</option>
            </select>
            <div><small>{t('import.duplicateHint')}</small></div>
          </div>


          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button onClick={() => send(true)} disabled={busy}>{t('import.simulate')}</button>
            <button onClick={() => send(false)} disabled={busy}>{t('import.runImport')}</button>
            <button onClick={reset} disabled={busy}>{t('common.cancel', 'Cancel')}</button>
          </div>
        </>
      )}

      {result && (
        <div style={{ marginTop: 12, borderTop: '1px solid #e2e8f0', paddingTop: 8 }}>
          <h3>{result.dryRun ? t('import.simulationResult') : t('admin.result')}</h3>
          <p>
            {t('import.toCreate')}: <strong>{result.inserted}</strong> -{' '}
            {t('import.toUpdate')}: <strong>{result.updated}</strong> -{' '}
            {t('import.duplicated')}: <strong>{result.duplicated || 0}</strong> -{' '}
            {t('import.rejected')}: <strong>{result.skipped?.length || 0}</strong>
          </p>
          {result.duplicates?.length > 0 && (
            <>
              <p><small><strong>{result.duplicates.length}</strong> {t('import.duplicatesFound')}</small></p>
              <table>
                <thead><tr><th>Line</th><th>{t('inventory.code')}</th><th>Reason</th><th>{t('common.actions')}</th></tr></thead>
                <tbody>{result.duplicates.slice(0, 50).map((d, i) => (
                  <tr key={i}><td>{d.line}</td><td>{d.asset || ''}</td><td>{d.reason}</td><td>{t(`import.dup_${d.action}`, d.action)}</td></tr>
                ))}</tbody>
              </table>
            </>
          )}

          {result.sample?.length > 0 && (
            <table>
              <thead>
                <tr>{Object.keys(result.sample[0]).map(k => <th key={k}>{k}</th>)}</tr>
              </thead>
              <tbody>
                {result.sample.map((s, i) => (
                  <tr key={i}>{Object.keys(result.sample[0]).map(k => <td key={k}>{String(s[k] ?? '')}</td>)}</tr>
                ))}
              </tbody>
            </table>
          )}
          {result.skipped?.length > 0 && (
            <table>
              <thead><tr><th>Line</th><th>{t('inventory.code')}</th><th>Reason</th></tr></thead>
              <tbody>{result.skipped.slice(0, 50).map((s, i) => (
                <tr key={i}><td>{s.line}</td><td>{s.asset || ''}</td><td>{s.reason}</td></tr>
              ))}</tbody>
            </table>
          )}
          {result.warnings?.length > 0 && (
            <p><small>{result.warnings.length} {t('import.warnings')}</small></p>
          )}
        </div>
      )}
    </div>
  );
}
