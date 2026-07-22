// ── WMS Core App ──────────────────────────────────────────────────────────────
'use strict';

const App = (() => {
  // ── Theme ────────────────────────────────────────────────────────────────
  function initTheme() {
    const saved = localStorage.getItem('wms-theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    const toggle = document.getElementById('themeToggle');
    if (toggle) {
      if (saved === 'dark') toggle.classList.add('on');
      toggle.addEventListener('click', () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const next   = isDark ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('wms-theme', next);
        toggle.classList.toggle('on', next === 'dark');
      });
    }
  }

  // ── Sidebar toggle ───────────────────────────────────────────────────────
  function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    const main    = document.getElementById('mainContent');
    const toggle  = document.getElementById('sidebarToggle');
    const overlay = document.getElementById('mobileOverlay');
    if (!sidebar) return;

    const isMobile = () => window.innerWidth <= 768;

    toggle?.addEventListener('click', () => {
      if (isMobile()) {
        sidebar.classList.toggle('mobile-open');
        overlay?.classList.toggle('show', sidebar.classList.contains('mobile-open'));
      } else {
        sidebar.classList.toggle('collapsed');
        main?.classList.toggle('expanded', sidebar.classList.contains('collapsed'));
      }
    });

    overlay?.addEventListener('click', () => {
      sidebar.classList.remove('mobile-open');
      overlay.classList.remove('show');
    });
  }

  // ── Active nav link ──────────────────────────────────────────────────────
  function markActiveNav() {
    const page = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });
  }

  // ── Warehouse selector ───────────────────────────────────────────────────
  function initWarehouseSelector() {
    const sel   = document.getElementById('warehouseSelector');
    const label = document.getElementById('whLabel');
    if (!sel || !label || !window.WMS_DATA) return;
    WMS_DATA.warehouses.forEach(wh => {
      const opt = document.createElement('option');
      opt.value = wh.id;
      opt.textContent = wh.name;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => {
      label.textContent = sel.options[sel.selectedIndex].text;
      App.toast(`Switched to ${label.textContent}`, 'info');
    });
  }

  // ── Global search ────────────────────────────────────────────────────────
  function initSearch() {
    const input    = document.getElementById('globalSearch');
    const dropdown = document.getElementById('searchDropdown');
    if (!input || !dropdown || !window.WMS_DATA) return;

    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const q = input.value.trim().toLowerCase();
        if (q.length < 2) { dropdown.classList.remove('open'); return; }
        const results = WMS_DATA.items
          .filter(i =>
            i.name.toLowerCase().includes(q) ||
            i.sku.toLowerCase().includes(q) ||
            i.barcode.includes(q) ||
            i.category.toLowerCase().includes(q)
          ).slice(0, 8);

        dropdown.innerHTML = results.length ? results.map(i => `
          <div class="search-result-item" onclick="location.href='item-details.html?id=${i.id}'">
            <img src="${i.image}" class="search-result-icon" alt="">
            <div>
              <div class="font-600">${highlight(i.name, q)}</div>
              <div class="search-sku">${i.sku} · ${i.rack}</div>
            </div>
            <span class="badge ${statusBadge(i.status)}" style="margin-left:auto">${i.status}</span>
          </div>`) .join('') :
          '<div class="search-result-item text-muted">No results found</div>';

        dropdown.classList.add('open');
      }, 200);
    });

    document.addEventListener('click', e => {
      if (!input.contains(e.target)) dropdown.classList.remove('open');
    });
  }

  function highlight(text, q) {
    const re = new RegExp(`(${q})`, 'gi');
    return text.replace(re, '<mark style="background:var(--primary-alpha);color:var(--primary);border-radius:2px">$1</mark>');
  }

  // ── Notifications ────────────────────────────────────────────────────────
  function initNotifications() {
    const btn      = document.getElementById('notifBtn');
    const dropdown = document.getElementById('notifDropdown');
    const badge    = document.getElementById('notifBadge');
    if (!btn || !dropdown || !window.WMS_DATA) return;

    const notifs  = WMS_DATA.notifications;
    const unread  = notifs.filter(n => !n.read).length;
    if (badge) badge.textContent = unread;

    const list = dropdown.querySelector('.notif-list');
    if (list) {
      list.innerHTML = notifs.map(n => `
        <div class="notif-item ${n.read ? '' : 'unread'}">
          <div class="notif-icon-wrap ${n.type}"><i class="fa-solid fa-${n.icon}"></i></div>
          <div class="notif-content">
            <div class="notif-item-title">${n.title}</div>
            <div class="notif-item-msg">${n.msg}</div>
            <div class="notif-time">${n.time}</div>
          </div>
        </div>`).join('');
    }

    btn.addEventListener('click', e => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });
    document.addEventListener('click', e => {
      if (!btn.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
      }
    });
  }

  // ── Toast ────────────────────────────────────────────────────────────────
  function toast(msg, type = 'success', title = '') {
    const ICONS = { success:'check', error:'xmark', warning:'triangle-exclamation', info:'circle-info' };
    const TITLES = { success:'Success', error:'Error', warning:'Warning', info:'Info' };
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `
      <div class="toast-icon"><i class="fa-solid fa-${ICONS[type]||'circle-info'}"></i></div>
      <div class="toast-body">
        <div class="toast-title">${title || TITLES[type]}</div>
        <div class="toast-msg">${msg}</div>
      </div>
      <div class="toast-close" onclick="this.parentElement.remove()"><i class="fa-solid fa-xmark"></i></div>`;
    container.appendChild(el);
    requestAnimationFrame(() => { requestAnimationFrame(() => el.classList.add('show')); });
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 4000);
  }

  // ── Modal helpers ─────────────────────────────────────────────────────────
  function openModal(id)  {
    const m = document.getElementById(id);
    if (m) m.classList.add('open');
  }
  function closeModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.remove('open');
  }
  function initModals() {
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', e => {
        if (e.target === backdrop) backdrop.classList.remove('open');
      });
    });
    document.querySelectorAll('[data-modal-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('.modal-backdrop')?.classList.remove('open');
      });
    });
    document.querySelectorAll('[data-modal-open]').forEach(btn => {
      btn.addEventListener('click', () => openModal(btn.dataset.modalOpen));
    });
  }

  // ── Status badge helper ───────────────────────────────────────────────────
  function statusBadge(status) {
    const map = {
      'Active':'badge-success', 'Low Stock':'badge-warning',
      'Out of Stock':'badge-danger', 'Discontinued':'badge-ghost',
      'Completed':'badge-success', 'Pending':'badge-warning', 'Failed':'badge-danger'
    };
    return map[status] || 'badge-ghost';
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────
  function initTabs() {
    document.querySelectorAll('.tab-bar').forEach(bar => {
      bar.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const group = btn.dataset.tabGroup || bar.id;
          bar.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          document.querySelectorAll(`.tab-panel[data-tab-group="${group}"]`)
            .forEach(p => p.classList.toggle('active', p.dataset.tab === btn.dataset.tab));
        });
      });
    });
  }

  // ── Format helpers ────────────────────────────────────────────────────────
  function fmt(n)    { return Number(n).toLocaleString('en-IN'); }
  function currency(n){ return '₹' + Number(n).toLocaleString('en-IN'); }
  function pctColor(p){ return p >= 85 ? 'red' : p >= 50 ? 'yellow' : 'green'; }

  // ── Init all ──────────────────────────────────────────────────────────────
  function init() {
    initTheme();
    initSidebar();
    markActiveNav();
    initWarehouseSelector();
    initSearch();
    initNotifications();
    initModals();
    initTabs();
  }

  return { init, toast, openModal, closeModal, statusBadge, fmt, currency, pctColor, highlight };
})();

document.addEventListener('DOMContentLoaded', App.init);
