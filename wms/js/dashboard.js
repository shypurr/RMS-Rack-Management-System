'use strict';
document.addEventListener('DOMContentLoaded', () => {
  if (!window.WMS_DATA) return;
  const D = WMS_DATA;

  // ── Stat cards ──────────────────────────────────────────────────────────
  const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
  set('statTotalItems',    App.fmt(D.totalItems));
  set('statReceived',      App.fmt(D.todayReceived));
  set('statDispatched',    App.fmt(D.todayDispatched));
  set('statOccupiedRacks', D.occupiedRacks);
  set('statVacantRacks',   D.vacantRacks);
  set('statLowStock',      D.lowStockItems);

  // ── Inventory Trend Chart ───────────────────────────────────────────────
  const trendCtx = document.getElementById('chartTrend');
  if (trendCtx && window.Chart) {
    new Chart(trendCtx, {
      type: 'line',
      data: {
        labels: D.chartLabels,
        datasets: [
          {
            label: 'Received',
            data:   D.trendReceived,
            borderColor: '#0191D0',
            backgroundColor: 'rgba(1,145,208,.08)',
            fill: true, tension: .4,
            pointBackgroundColor: '#0191D0',
            pointRadius: 4,
          },
          {
            label: 'Dispatched',
            data:   D.trendDispatched,
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34,197,94,.08)',
            fill: true, tension: .4,
            pointBackgroundColor: '#22c55e',
            pointRadius: 4,
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,.05)' } },
          x: { grid: { display: false } }
        }
      }
    });
  }

  // ── Rack Occupancy Donut ────────────────────────────────────────────────
  const rackCtx = document.getElementById('chartRack');
  if (rackCtx && window.Chart) {
    new Chart(rackCtx, {
      type: 'doughnut',
      data: {
        labels: ['Occupied (≥85%)', 'Partial (1-84%)', 'Vacant'],
        datasets: [{
          data: [D.occupiedRacks, D.partialRacks, D.vacantRacks],
          backgroundColor: ['#ef4444','#f59e0b','#22c55e'],
          borderWidth: 0,
          hoverOffset: 8,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { padding: 20, boxWidth: 10 } }
        },
        cutout: '65%'
      }
    });
  }

  // ── Warehouse Capacity Bar Chart ────────────────────────────────────────
  const whCtx = document.getElementById('chartWarehouses');
  if (whCtx && window.Chart) {
    new Chart(whCtx, {
      type: 'bar',
      data: {
        labels: D.warehouses.map(w => w.name),
        datasets: [
          {
            label: 'Occupied',
            data:  D.warehouses.map(w => w.occupied),
            backgroundColor: '#0191D0',
            borderRadius: 4,
          },
          {
            label: 'Free',
            data:  D.warehouses.map(w => w.capacity - w.occupied),
            backgroundColor: 'rgba(1,145,208,.12)',
            borderRadius: 4,
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(0,0,0,.05)' } } }
      }
    });
  }

  // ── Category Distribution ───────────────────────────────────────────────
  const catCtx = document.getElementById('chartCategory');
  if (catCtx && window.Chart) {
    const catCount = {};
    D.items.forEach(i => catCount[i.category] = (catCount[i.category] || 0) + i.qty);
    const top10 = Object.entries(catCount).sort((a,b)=>b[1]-a[1]).slice(0,8);
    new Chart(catCtx, {
      type: 'bar',
      data: {
        labels: top10.map(c=>c[0]),
        datasets: [{
          label: 'Qty',
          data:  top10.map(c=>c[1]),
          backgroundColor: ['#0191D0','#22c55e','#f59e0b','#ef4444','#a855f7','#14b8a6','#f97316','#6366f1'],
          borderRadius: 4,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, grid: { color: 'rgba(0,0,0,.05)' } }, y: { grid: { display: false } } }
      }
    });
  }

  // ── Recent activity ─────────────────────────────────────────────────────
  const activityList = document.getElementById('recentActivity');
  if (activityList) {
    const recentMovs = D.movements.slice(-8).reverse();
    activityList.innerHTML = recentMovs.map(m => `
      <div class="timeline-item">
        <div class="timeline-dot ${m.status === 'Completed' ? 'success' : 'warning'}">
          <i class="fa-solid fa-${m.status === 'Completed' ? 'check' : 'clock'}"></i>
        </div>
        <div class="timeline-text font-600">${m.itemName}</div>
        <div class="timeline-meta">${m.fromRack} → ${m.toRack} · ${m.qty} units · ${m.movedBy}</div>
        <div class="timeline-meta">${m.date} · <span class="badge ${m.status==='Completed'?'badge-success':'badge-warning'}">${m.status}</span></div>
      </div>`).join('');
  }

  // ── Recent receivings ───────────────────────────────────────────────────
  const rcvList = document.getElementById('recentReceivings');
  if (rcvList) {
    const recent = D.receivings.slice(-6).reverse();
    rcvList.innerHTML = `
      <div class="data-table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>RCV ID</th><th>Item</th><th>Supplier</th><th>Qty</th><th>Date</th>
          </tr></thead>
          <tbody>${recent.map(r=>`
            <tr>
              <td class="text-primary-color font-600">${r.id}</td>
              <td class="truncate" style="max-width:160px">${r.itemName}</td>
              <td>${r.supplier}</td>
              <td><span class="badge badge-success">${r.qty}</span></td>
              <td class="text-muted">${r.date}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }
});
