'use strict';
const Inventory = (() => {
  let items    = [];
  let filtered = [];
  let sortKey  = 'name';
  let sortAsc  = true;
  let page     = 1;
  const PAGE_SIZE = 20;

  // ── Build table row ───────────────────────────────────────────────────────
  function row(i) {
    return `
    <tr onclick="Inventory.showDetails('${i.id}')" style="cursor:pointer">
      <td><span class="font-600 text-primary-color" style="font-size:11px">${i.barcode}</span></td>
      <td class="font-600">${i.sku}</td>
      <td><img src="${i.image}" class="item-img" alt=""></td>
      <td>
        <div class="font-600 truncate" style="max-width:180px">${i.name}</div>
        <div class="text-muted text-xs">${i.brand}</div>
      </td>
      <td>${i.category}</td>
      <td>${i.brand}</td>
      <td><span class="badge" style="background:var(--bg)">${i.color}</span></td>
      <td>${i.size}</td>
      <td class="font-600">${App.fmt(i.qty)}</td>
      <td class="text-muted">${i.reserved}</td>
      <td class="font-600 text-primary-color">${i.available}</td>
      <td class="text-xs">${i.warehouseName}</td>
      <td>${i.zone}</td>
      <td>${i.aisle}</td>
      <td class="font-600">${i.rack}</td>
      <td>${i.shelf}</td>
      <td>${i.bin}</td>
      <td><span class="badge ${App.statusBadge(i.status)} badge-dot">${i.status}</span></td>
      <td>
        <div class="flex gap-2" onclick="event.stopPropagation()">
          <button class="btn btn-sm btn-outline" onclick="Inventory.editItem('${i.id}')">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="btn btn-sm btn-ghost" onclick="Inventory.moveItem('${i.id}')">
            <i class="fa-solid fa-arrows-up-down"></i>
          </button>
          <button class="btn btn-sm btn-ghost" onclick="Inventory.deleteItem('${i.id}')">
            <i class="fa-solid fa-trash" style="color:var(--danger)"></i>
          </button>
        </div>
      </td>
    </tr>`;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function render() {
    const tbody = document.getElementById('inventoryTbody');
    const total = document.getElementById('totalCount');
    const info  = document.getElementById('pageInfo');
    if (!tbody) return;

    const start  = (page - 1) * PAGE_SIZE;
    const paged  = filtered.slice(start, start + PAGE_SIZE);
    tbody.innerHTML = paged.length ? paged.map(row).join('') :
      `<tr><td colspan="19"><div class="empty-state"><i class="fa-solid fa-box-open"></i><h3>No items found</h3><p>Try adjusting your search or filters.</p></div></td></tr>`;

    if (total) total.textContent = `${App.fmt(filtered.length)} items`;
    if (info)  info.textContent  = `Showing ${start+1}–${Math.min(start+PAGE_SIZE, filtered.length)} of ${filtered.length}`;
    renderPagination();
    updateSortHeaders();
  }

  function renderPagination() {
    const pages = Math.ceil(filtered.length / PAGE_SIZE);
    const el    = document.getElementById('pagination');
    if (!el) return;

    let html = `
      <button class="page-btn" onclick="Inventory.setPage(${page-1})" ${page===1?'disabled':''}><i class="fa-solid fa-chevron-left"></i></button>`;
    for (let p = Math.max(1,page-2); p <= Math.min(pages,page+2); p++) {
      html += `<button class="page-btn ${p===page?'active':''}" onclick="Inventory.setPage(${p})">${p}</button>`;
    }
    html += `<button class="page-btn" onclick="Inventory.setPage(${page+1})" ${page>=pages?'disabled':''}><i class="fa-solid fa-chevron-right"></i></button>`;
    el.innerHTML = html;
  }

  function updateSortHeaders() {
    document.querySelectorAll('.data-table th[data-sort]').forEach(th => {
      const isSorted = th.dataset.sort === sortKey;
      th.classList.toggle('sorted', isSorted);
      const icon = th.querySelector('.sort-icon');
      if (icon) icon.className = `sort-icon fa-solid fa-${!isSorted ? 'sort' : sortAsc ? 'sort-up' : 'sort-down'}`;
    });
  }

  // ── Filter & Sort ─────────────────────────────────────────────────────────
  function applyFilters() {
    const q   = (document.getElementById('invSearch')?.value || '').toLowerCase();
    const cat = document.getElementById('filterCat')?.value  || '';
    const sta = document.getElementById('filterStatus')?.value || '';
    const wh  = document.getElementById('filterWh')?.value   || '';

    filtered = items.filter(i => {
      const matchQ   = !q || i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q) || i.barcode.includes(q) || i.color.toLowerCase().includes(q);
      const matchCat = !cat || i.category === cat;
      const matchSta = !sta || i.status === sta;
      const matchWh  = !wh  || i.warehouse === wh;
      return matchQ && matchCat && matchSta && matchWh;
    });

    filtered.sort((a,b) => {
      let va = a[sortKey], vb = b[sortKey];
      if (typeof va === 'string') va = va.toLowerCase(), vb = vb.toLowerCase();
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ?  1 : -1;
      return 0;
    });

    page = 1;
    render();
  }

  // ── Public API ────────────────────────────────────────────────────────────
  function setPage(p) {
    const max = Math.ceil(filtered.length / PAGE_SIZE);
    if (p < 1 || p > max) return;
    page = p;
    render();
    document.getElementById('inventoryTbody')?.closest('.card')?.scrollIntoView({behavior:'smooth',block:'start'});
  }

  function sortBy(key) {
    if (sortKey === key) sortAsc = !sortAsc; else { sortKey = key; sortAsc = true; }
    applyFilters();
  }

  function editItem(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    document.getElementById('editItemId').value   = id;
    document.getElementById('editItemName').value = item.name;
    document.getElementById('editItemQty').value  = item.qty;
    document.getElementById('editItemStatus').value = item.status;
    App.openModal('editModal');
  }

  function saveEdit() {
    const id     = document.getElementById('editItemId').value;
    const item   = items.find(i => i.id === id);
    if (!item) return;
    item.name   = document.getElementById('editItemName').value;
    item.qty    = parseInt(document.getElementById('editItemQty').value);
    item.status = document.getElementById('editItemStatus').value;
    item.available = item.qty - item.reserved;
    App.closeModal('editModal');
    applyFilters();
    App.toast(`${item.sku} updated successfully`);
  }

  function deleteItem(id) {
    if (!confirm('Delete this item from inventory?')) return;
    const idx = items.findIndex(i => i.id === id);
    if (idx !== -1) items.splice(idx, 1);
    applyFilters();
    App.toast('Item deleted', 'error');
  }

  function moveItem(id) {
    location.href = `move-item.html?id=${id}`;
  }

  function showDetails(id) {
    location.href = `item-details.html?id=${id}`;
  }

  function exportCSV() {
    const headers = ['Barcode','SKU','Name','Category','Brand','Color','Size','Qty','Available','Warehouse','Rack','Status'];
    const rows    = filtered.map(i => [i.barcode,i.sku,i.name,i.category,i.brand,i.color,i.size,i.qty,i.available,i.warehouseName,i.rack,i.status]);
    const csv     = [headers, ...rows].map(r => r.join(',')).join('\n');
    const link    = document.createElement('a');
    link.href     = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    link.download = `inventory_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    App.toast('Inventory exported to CSV');
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    if (!window.WMS_DATA) return;
    items    = WMS_DATA.items;
    filtered = [...items];
    applyFilters();

    // Populate filters
    const catSel = document.getElementById('filterCat');
    if (catSel) {
      WMS_DATA.categories.forEach(c => {
        const o = document.createElement('option'); o.value = c; o.textContent = c;
        catSel.appendChild(o);
      });
    }
    const whSel = document.getElementById('filterWh');
    if (whSel) {
      WMS_DATA.warehouses.forEach(w => {
        const o = document.createElement('option'); o.value = w.id; o.textContent = w.name;
        whSel.appendChild(o);
      });
    }

    // Search & filter listeners
    ['invSearch','filterCat','filterStatus','filterWh'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', applyFilters);
      document.getElementById(id)?.addEventListener('change', applyFilters);
    });

    // Sort listeners
    document.querySelectorAll('.data-table th[data-sort]').forEach(th => {
      th.addEventListener('click', () => sortBy(th.dataset.sort));
    });

    document.getElementById('btnExportCSV')?.addEventListener('click', exportCSV);
    document.getElementById('btnSaveEdit')?.addEventListener('click', saveEdit);
  }

  document.addEventListener('DOMContentLoaded', init);
  return { setPage, sortBy, editItem, deleteItem, moveItem, showDetails, exportCSV };
})();
