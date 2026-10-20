import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.js';
import { getDemoInfo } from '../lib/demo.js';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [demo, setDemo] = useState({ enabled: false });
  const nav = useNavigate();
  const { t, i18n } = useTranslation();

  useEffect(() => {
    getDemoInfo().then(setDemo);
    fetch('/api/sso/status').then(r => r.json()).then(d => setSsoEnabled(!!d.enabled)).catch(() => {});
    // Handle SSO callback landing
    const params = new URLSearchParams(location.search);
    if (params.get('sso') === 'ok') {
      try {
        const data = JSON.parse(decodeURIComponent(params.get('data')));
        localStorage.setItem('ptx_token', data.token);
        localStorage.setItem('ptx_user', JSON.stringify(data.user));
        if (data.user.language) { localStorage.setItem('ptx_lang', data.user.language); i18n.changeLanguage(data.user.language); }
        nav('/scan', { replace: true });
      } catch (e) { setErr('SSO parse error'); }
    } else if (params.get('sso') === 'pending') {
      setErr(t('login.pending'));
    }
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      const { token, user } = await api('/auth/login', { method: 'POST', body: { email, password } });
      localStorage.setItem('ptx_token', token);
      localStorage.setItem('ptx_user', JSON.stringify(user));
      if (user.language) { localStorage.setItem('ptx_lang', user.language); i18n.changeLanguage(user.language); }
      nav('/scan');
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="login-page">
      <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 8 }}>
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
      <form onSubmit={submit}>
        {/* Deux variantes : le rouge de marque n'atteint que 2,7:1 sur fond sombre, la variante claire 4,4:1 (voir styles.css) */}
        <div className="login-brand">
          <img className="logo-on-light" src="/brand/phoenix-logo.png" alt="" width="80" height="80" />
          <img className="logo-on-dark" src="/brand/phoenix-logo-on-dark.png" alt="" width="80" height="80" />
        </div>
        <h2>{t('login.title')}</h2>
        {ssoEnabled && (
          <>
            <a className="btn-sso" href="/api/sso/login">{t('login.sso')}</a>
            <div className="divider">- {t('login.or')} -</div>
          </>
        )}
        <input type="email" placeholder={t('login.email')} value={email} onChange={e => setEmail(e.target.value)} required />
        <input type="password" placeholder={t('login.password')} value={password} onChange={e => setPassword(e.target.value)} required />
        {err && <div className="error">{err}</div>}
        <button type="submit">{t('login.submit')}</button>
        {demo.enabled && (
          <div className="demo-box" data-testid="demo-box">
            <strong>{t('demo.title')}</strong>
            <p>{t('demo.intro')}</p>
            {demo.accounts.map(a => (
              <button key={a.email} type="button" className="secondary" data-testid={`demo-use-${a.role}`}
                onClick={() => { setEmail(a.email); setPassword(demo.password); setErr(''); }}>
                {t('demo.useAccount', { role: t('roles.' + a.role) })}
              </button>
            ))}
            <small>{t('demo.password')}: <code data-testid="demo-password">{demo.password}</code></small>
          </div>
        )}
      </form>
    </div>
  );
}
