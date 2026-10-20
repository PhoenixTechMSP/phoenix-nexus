import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { currentUser } from './lib/api.js';
import './i18n/index.js';
import LanguageSwitcher from './components/LanguageSwitcher.jsx';
import ThemeToggle, { initTheme } from './components/ThemeToggle.jsx';
import Login from './pages/Login.jsx';
import Scan from './pages/Scan.jsx';
import Inventory from './pages/Inventory.jsx';
import Logs from './pages/Logs.jsx';
import Agents from './pages/Agents.jsx';
import Admin from './pages/Admin.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Forecast from './pages/Forecast.jsx';
import CMDB from './pages/CMDB.jsx';
import SAM from './pages/SAM.jsx';
import { getDemoInfo } from './lib/demo.js';
import './styles.css';

function Layout({ children }) {
  const user = currentUser();
  const nav = useNavigate();
  const { t } = useTranslation();
  const [demo, setDemo] = useState({ enabled: false });
  useEffect(() => { getDemoInfo().then(setDemo); }, []);
  const logout = () => { localStorage.removeItem('ptx_token'); localStorage.removeItem('ptx_user'); nav('/login'); };
  return (
    <div className="app">
      {demo.enabled && <div className="demo-banner" data-testid="demo-banner">{t('demo.banner')}</div>}
      <header>
        <h1 className="brand">
          {/* alt vide : le nom est ecrit juste a cote, un lecteur d'ecran ne doit pas le lire deux fois */}
          <img className="brand-mark" src="/brand/phoenix-mark-header.png" alt="" width="32" height="32" />
          <span>{t('app.title')}</span>
        </h1>
        <nav>
          <Link to="/scan">{t('nav.scan')}</Link>
          <Link to="/inventory">{t('nav.inventory')}</Link>
          <Link to="/cmdb">{t('nav.cmdb')}</Link>
          <Link to="/sam">{t('nav.sam')}</Link>
          <Link to="/logs">{t('nav.logs')}</Link>
          <Link to="/dashboard">{t('nav.dashboard')}</Link>
          <Link to="/forecast">{t('nav.forecast')}</Link>
          <Link to="/agents">{t('nav.agents')}</Link>
          {user?.role === 'admin' && <Link to="/admin">{t('nav.admin')}</Link>}
        </nav>
        <div className="user">
          <LanguageSwitcher />
          <ThemeToggle />
          <span>{user?.full_name} ({t('roles.' + (user?.role || 'staff'))})</span>
          <button onClick={logout}>{t('app.logout')}</button>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

function Protected({ children }) {
  if (!localStorage.getItem('ptx_token')) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

initTheme();

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/scan" element={<Protected><Scan /></Protected>} />
      <Route path="/inventory" element={<Protected><Inventory /></Protected>} />
      <Route path="/cmdb" element={<Protected><CMDB /></Protected>} />
      <Route path="/sam" element={<Protected><SAM /></Protected>} />
      <Route path="/logs" element={<Protected><Logs /></Protected>} />
      <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
      <Route path="/forecast" element={<Protected><Forecast /></Protected>} />
      <Route path="/agents" element={<Protected><Agents /></Protected>} />
      <Route path="/admin" element={<Protected><Admin /></Protected>} />
      <Route path="*" element={<Navigate to="/scan" replace />} />
    </Routes>
  </BrowserRouter>
);
