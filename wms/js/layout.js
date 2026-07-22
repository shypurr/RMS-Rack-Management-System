// layout.js — injects sidebar + topbar into every page
(function(){
  const SIDEBAR_HTML = `
  <aside class="sidebar" id="sidebar">
    <div class="logo">
      <div class="logo-icon"><i class="fa-solid fa-warehouse"></i></div>
      <div class="logo-text">Vastra<span>WMS</span></div>
    </div>
    <nav class="sidebar-nav">
      <div class="sidebar-section-title">Main Menu</div>
      <a href="index.html"          class="nav-item" data-page="index.html">        <i class="fa-solid fa-gauge-high"></i>      <span class="nav-label">Dashboard</span></a>
      <a href="inventory.html"      class="nav-item" data-page="inventory.html">    <i class="fa-solid fa-boxes-stacked"></i>   <span class="nav-label">Inventory</span></a>
      <a href="receive-item.html"   class="nav-item" data-page="receive-item.html"> <i class="fa-solid fa-truck-ramp-box"></i>  <span class="nav-label">Receive Items</span></a>
      <a href="move-item.html"      class="nav-item" data-page="move-item.html">    <i class="fa-solid fa-arrows-up-down"></i>  <span class="nav-label">Move Items</span></a>
      <a href="rack-management.html" class="nav-item" data-page="rack-management.html"><i class="fa-solid fa-layer-group"></i><span class="nav-label">Rack Management</span></a>

      <div class="sidebar-section-title">Operations</div>
      <a href="reports.html"        class="nav-item" data-page="reports.html">      <i class="fa-solid fa-chart-bar"></i>       <span class="nav-label">Reports</span></a>
      <a href="#"                   class="nav-item">                                <i class="fa-solid fa-truck"></i>           <span class="nav-label">Orders</span><span class="sidebar-badge">12</span></a>
      <a href="#"                   class="nav-item">                                <i class="fa-solid fa-users"></i>           <span class="nav-label">Users</span></a>

      <div class="sidebar-section-title">System</div>
      <a href="settings.html"       class="nav-item" data-page="settings.html">     <i class="fa-solid fa-gear"></i>            <span class="nav-label">Settings</span></a>
    </nav>
    <div class="sidebar-footer">
      <div class="sidebar-user">
        <div class="avatar">RK</div>
        <div class="sidebar-user-info">
          <div class="sidebar-user-name">Raj Kumar</div>
          <div class="sidebar-user-role">Warehouse Manager</div>
        </div>
      </div>
    </div>
  </aside>`;

  const TOPBAR_HTML = `
  <header class="topbar">
    <div class="topbar-toggle" id="sidebarToggle"><i class="fa-solid fa-bars"></i></div>
    <div class="warehouse-selector">
      <i class="fa-solid fa-warehouse"></i>
      <span id="whLabel">Main Warehouse</span>
      <select id="warehouseSelector" style="position:absolute;opacity:0;inset:0;cursor:pointer"></select>
      <i class="fa-solid fa-chevron-down" style="margin-left:auto;font-size:10px;color:var(--text-muted)"></i>
    </div>
    <div class="topbar-search" style="position:relative">
      <span class="search-icon"><i class="fa-solid fa-magnifying-glass"></i></span>
      <input type="text" id="globalSearch" placeholder="Search items, SKU, barcode…" autocomplete="off">
      <div class="search-result-dropdown" id="searchDropdown"></div>
    </div>
    <div class="topbar-actions">
      <div class="topbar-btn" title="Notifications" id="notifBtn" style="position:relative">
        <i class="fa-solid fa-bell"></i>
        <span class="notif-badge" id="notifBadge">3</span>
        <div class="notif-dropdown" id="notifDropdown">
          <div class="notif-header">
            <span class="notif-title">Notifications</span>
            <button class="btn btn-sm btn-ghost" onclick="document.querySelectorAll('.notif-item').forEach(el=>el.classList.remove('unread'))">Mark all read</button>
          </div>
          <div class="notif-list"></div>
        </div>
      </div>
      <div class="topbar-btn" title="Full Screen" onclick="document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()">
        <i class="fa-solid fa-expand"></i>
      </div>
      <div class="theme-toggle" id="themeToggle" title="Toggle Dark Mode"></div>
      <div class="topbar-user">
        <div class="topbar-avatar">RK</div>
        <div class="topbar-user-info">
          <div class="topbar-user-name">Raj Kumar</div>
          <div class="topbar-user-role">Admin</div>
        </div>
      </div>
    </div>
  </header>
  <div class="mobile-overlay" id="mobileOverlay"></div>`;

  // Inject into page
  const shell = document.getElementById('wmsShell');
  if (shell) {
    shell.insertAdjacentHTML('afterbegin', SIDEBAR_HTML);
    const main = document.getElementById('mainContent');
    if (main) main.insertAdjacentHTML('afterbegin', TOPBAR_HTML);
  }
})();
