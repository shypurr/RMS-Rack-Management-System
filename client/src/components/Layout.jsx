import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useTheme } from '../lib/useTheme.js';
import { api, clearToken } from '../api/client.js';

const NAV = [
  { section: 'Main Menu' },
  { to: '/', icon: 'gauge-high', label: 'Dashboard', end: true },
  { to: '/racks', icon: 'layer-group', label: 'Rack Management' },
  { to: '/items', icon: 'box', label: 'Item Management' },
  { to: '/add', icon: 'truck-ramp-box', label: 'Putaway' },
  { to: '/picklist', icon: 'clipboard-list', label: 'Picklist' },
  { to: '/move', icon: 'arrows-up-down', label: 'Move Item' },
  { section: 'Operations' },
  { to: '/reports', icon: 'chart-bar', label: 'Reports' },
  { to: '/report', icon: 'file-lines', label: 'Rack Report' },
  { to: '/audit', icon: 'clock-rotate-left', label: 'Audit Log' },
];

// "Vastra Textiles" → "VT". Two words max, so the avatar stays readable.
const initialsOf = (name = '') =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '—';

export default function Layout() {
  const { theme, toggle } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [org, setOrg] = useState(null);

  // Restores the identity on a page refresh. A dead session 401s, and
  // api/client.js redirects to /login for us.
  useEffect(() => { api.me().then(setOrg).catch(() => {}); }, []);

  const orgName = org?.name || 'Loading…';
  const initials = initialsOf(org?.name);

  const logout = async () => {
    try { await api.logout(); } catch { /* leaving anyway */ }
    clearToken();
    window.location.replace('/login');
  };

  const isMobile = () => window.innerWidth <= 768;
  const onToggle = () => (isMobile() ? setMobileOpen((o) => !o) : setCollapsed((c) => !c));

  return (
    <div className="wms-shell">
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="logo">
          <div className="logo-icon"><i className="fa-solid fa-warehouse" /></div>
          <div className="logo-text">Vastra<span>WMS</span></div>
        </div>
        <nav className="sidebar-nav">
          {NAV.map((n, i) =>
            n.section ? (
              <div key={`s${i}`} className="sidebar-section-title">{n.section}</div>
            ) : (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setMobileOpen(false)}
              >
                <i className={`fa-solid fa-${n.icon}`} />
                <span className="nav-label">{n.label}</span>
              </NavLink>
            )
          )}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="avatar">{initials}</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{orgName}</div>
              <div className="sidebar-user-role">Vastra account</div>
            </div>
          </div>
        </div>
      </aside>

      <div className={`main-content ${collapsed ? 'expanded' : ''}`}>
        <header className="topbar">
          <div className="topbar-toggle" onClick={onToggle}><i className="fa-solid fa-bars" /></div>
          <div className="topbar-actions">
            <div className="topbar-btn" title="Full Screen"
              onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())}>
              <i className="fa-solid fa-expand" />
            </div>
            <div className={`theme-toggle ${theme === 'dark' ? 'on' : ''}`} onClick={toggle} title="Toggle Dark Mode" />
            <div className="topbar-user">
              <div className="topbar-avatar">{initials}</div>
              <div className="topbar-user-info">
                <div className="topbar-user-name">{orgName}</div>
                <div className="topbar-user-role">Vastra account</div>
              </div>
            </div>
            <div className="topbar-btn" title="Log out" onClick={logout}>
              <i className="fa-solid fa-right-from-bracket" />
            </div>
          </div>
        </header>

        <main className="page-content">
          <Outlet />
        </main>
      </div>

      {mobileOpen && <div className="mobile-overlay show" onClick={() => setMobileOpen(false)} />}
    </div>
  );
}
