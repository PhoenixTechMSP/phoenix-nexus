import { useEffect, useState } from 'react';

const KEY = 'ptx_theme';

export function initTheme() {
  const saved = localStorage.getItem(KEY);
  const theme = saved || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  return theme;
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState(() => initTheme());

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(KEY, theme);
  }, [theme]);

  const dark = theme === 'dark';
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      title={dark ? 'Light mode' : 'Dark mode'}
      aria-label={dark ? 'Light mode' : 'Dark mode'}
    >
      {dark ? '☀' : '☾'}
    </button>
  );
}
