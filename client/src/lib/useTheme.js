import { useEffect, useState } from 'react';

// Light/dark theme stored in localStorage, applied to <html data-theme>.
export function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('wms-theme') || 'light');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('wms-theme', theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  return { theme, toggle };
}
