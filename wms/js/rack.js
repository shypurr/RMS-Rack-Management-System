'use strict';
const RackMgr = (() => {
  let racks    = [];
  let selected = null;

  function statusLabel(s) {
    return {vacant:'Vacant',low:'Low',partial:'Partial',full:'Full'}[s] || s;
  }

  function renderZones() {
    if (!window.WMS_DATA) return;
    racks = WMS_DATA.racks;
    const container = document.getElementById('zoneContainer');
    if (!container) return;

    const zones = [...new Set(racks.map(r => r.zone))];
    container.innerHTML = zones.map(zone => {
      const zoneRacks = racks.filter(r => r.zone === zone);
      return `
        <div class="mb-6">
          <div class="flex items-center gap-3 mb-4">
            <div class="zone-label">Zone ${zone}</div>
            <div class="flex gap-2" style="font-size:12px;color:var(--text-muted)">
              <span>${zoneRacks.filter(r=>r.status==='vacant').length} vacant</span>·
              <span>${zoneRacks.filter(r=>r.status==='partial').length} partial</span>·
              <span>${zoneRacks.filter(r=>r.status==='full').length} full</span>
            </div>
          </div>
          <div class="zone-row">
            ${zoneRacks.map(r => `
              <div class="rack-card ${r.status}" onclick="RackMgr.openRack('${r.id}')">
                <div class="rack-status-dot"></div>
                <div class="rack-name">${r.name}</div>
                <div class="rack-pct">${r.occupied}/${r.capacity} units</div>
                <div class="progress">
                  <div class="progress-bar ${App.pctColor(r.pct)}" style="width:${r.pct}%"></div>
                </div>
                <div style="font-size:10px;color:var(--text-muted);margin-top:4px">${r.pct}% used</div>
              </div>`).join('')}
          </div>
        </div>`;
    }).join('');
  }

  function openRack(id) {
    selected = racks.find(r => r.id === id);
    if (!selected) return;

    const modal = document.getElementById('rackDetailModal');
    if (!modal) return;

    modal.querySelector('.modal-title').textContent = `Rack ${selected.name}`;
    modal.querySelector('#rackDetailBody').innerHTML = `
      <div class="grid cols-2 gap-col-4 mb-4">
        <div><div class="text-xs text-muted">Zone / Aisle</div><div class="font-600">Zone ${selected.zone} · ${selected.aisle}</div></div>
        <div><div class="text-xs text-muted">Rack ID</div><div class="font-600">${selected.id}</div></div>
        <div><div class="text-xs text-muted">Type</div><div class="font-600">${selected.type}</div></div>
        <div><div class="text-xs text-muted">Status</div>
          <span class="badge ${selected.status==='full'?'badge-danger':selected.status==='partial'?'badge-warning':selected.status==='low'?'badge-success':'badge-ghost'}">${statusLabel(selected.status)}</span>
        </div>
      </div>
      <div class="mb-4">
        <div class="flex items-center justify-content-between mb-2">
          <span class="text-xs text-muted">Capacity</span>
          <span class="font-600">${selected.occupied} / ${selected.capacity} units (${selected.pct}%)</span>
        </div>
        <div class="progress" style="height:10px">
          <div class="progress-bar ${App.pctColor(selected.pct)}" style="width:${selected.pct}%"></div>
        </div>
      </div>
      <div class="card" style="margin-bottom:0">
        <div class="card-header"><span class="card-title">Items in this Rack</span><span class="badge badge-primary">${selected.items.length}</span></div>
        <div style="max-height:200px;overflow-y:auto">
          ${selected.items.length ? `
          <table class="data-table">
            <thead><tr><th>Item ID</th><th>Name</th><th>Status</th></tr></thead>
            <tbody>${selected.items.slice(0,10).map(iid => {
              const it = WMS_DATA.items.find(x=>x.id===iid);
              return it ? `<tr><td class="text-primary-color">${it.id}</td><td>${it.name}</td><td><span class="badge ${App.statusBadge(it.status)}">${it.status}</span></td></tr>` : '';
            }).join('')}</tbody>
          </table>` : '<div class="empty-state" style="padding:24px"><i class="fa-solid fa-box-open"></i><p>No items in this rack</p></div>'}
        </div>
      </div>`;

    App.openModal('rackDetailModal');
  }

  function renderFinder() {
    if (!window.WMS_DATA) return;
    racks = WMS_DATA.racks;
    applyFinderFilter();
    // Populate zone filter
    const zoneFilter = document.getElementById('finderZone');
    if (zoneFilter) {
      [...new Set(racks.map(r=>r.zone))].forEach(z => {
        const o = document.createElement('option'); o.value=z; o.textContent=`Zone ${z}`;
        zoneFilter.appendChild(o);
      });
    }
    ['finderZone','finderType','finderSort'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', applyFinderFilter);
    });
    document.getElementById('finderSearch')?.addEventListener('input', applyFinderFilter);
  }

  function applyFinderFilter() {
    const zone  = document.getElementById('finderZone')?.value  || '';
    const type  = document.getElementById('finderType')?.value  || '';
    const sort  = document.getElementById('finderSort')?.value  || 'available';
    const q     = (document.getElementById('finderSearch')?.value || '').toLowerCase();

    let list = racks.filter(r => r.status !== 'full');
    if (zone) list = list.filter(r => r.zone === zone);
    if (type) list = list.filter(r => r.type === type);
    if (q)    list = list.filter(r => r.name.toLowerCase().includes(q));

    if (sort === 'available') list.sort((a,b) => b.available - a.available);
    else if (sort === 'pct')  list.sort((a,b) => a.pct - b.pct);
    else if (sort === 'name') list.sort((a,b) => a.name.localeCompare(b.name));

    const container = document.getElementById('finderGrid');
    if (!container) return;

    container.innerHTML = list.length ? list.map(r => `
      <div class="card hover-lift" style="cursor:pointer" onclick="RackMgr.selectFinderRack('${r.id}')">
        <div class="card-body">
          <div class="flex items-center gap-3 mb-3">
            <div style="width:40px;height:40px;border-radius:var(--radius-md);background:var(--primary-alpha);display:flex;align-items:center;justify-content:center;color:var(--primary);font-size:18px">
              <i class="fa-solid fa-warehouse"></i>
            </div>
            <div>
              <div class="font-700">${r.name}</div>
              <div class="text-xs text-muted">Zone ${r.zone} · ${r.type}</div>
            </div>
            <span class="badge ${r.status==='vacant'?'badge-success':r.status==='low'?'badge-success':'badge-warning'} ml-auto">${statusLabel(r.status)}</span>
          </div>
          <div class="progress mb-2">
            <div class="progress-bar ${App.pctColor(r.pct)}" style="width:${r.pct}%"></div>
          </div>
          <div class="flex gap-4" style="font-size:12px;color:var(--text-secondary)">
            <span><strong>${r.available}</strong> available</span>
            <span><strong>${r.occupied}</strong> occupied</span>
            <span><strong>${r.capacity}</strong> capacity</span>
          </div>
        </div>
      </div>`).join('') :
      `<div class="empty-state" style="grid-column:1/-1"><i class="fa-solid fa-search"></i><h3>No vacant racks found</h3><p>Try adjusting your filters.</p></div>`;
  }

  function selectFinderRack(id) {
    const r = racks.find(x => x.id === id);
    if (!r) return;
    App.toast(`Selected Rack: ${r.name} (${r.available} slots available)`, 'success');
  }

  function init() {
    renderZones();
    renderFinder();
  }

  document.addEventListener('DOMContentLoaded', init);
  return { openRack, selectFinderRack };
})();
