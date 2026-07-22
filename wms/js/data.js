// ── WMS Data Layer ────────────────────────────────────────────────────────────
// All sample data lives here. Every page imports from window.WMS_DATA.

(function () {
  'use strict';

  const COLORS    = ['Red','Blue','Green','Yellow','Pink','White','Black','Navy','Peach','Maroon','Olive','Beige','Grey','Orange','Purple'];
  const SIZES     = ['XS','S','M','L','XL','XXL','Free Size','2-4Y','4-6Y','6-8Y'];
  const ZONES     = ['A','B','C','D','E'];
  const STATUSES  = ['Active','Low Stock','Out of Stock','Discontinued'];
  const BRANDS    = ['Florina','Vastra','Charmeuse','Royal','SilkRoute','CottonKing','LinenHouse','StyleIndia','TrendyThreads','FashionHub'];
  const UNITS     = ['Piece','Set','Pair','Box','Roll'];
  const REASONS   = ['Restock','Sale','Transfer','Quality Check','Return','Adjustment'];
  const CATS      = ['Salwar Kameez','Saree','Lehenga','Kurti','Dupatta','Shirt','Trousers','Jacket','T-Shirt','Denim','Kids Wear','Ethnic Wear','Western Wear','Sportswear','Accessories'];
  const SUPPLIERS = [
    {id:'SUP-001',name:'Florina Textiles',city:'Surat'},
    {id:'SUP-002',name:'Vastra Exports',city:'Ahmedabad'},
    {id:'SUP-003',name:'Charmeuse Fabrics',city:'Mumbai'},
    {id:'SUP-004',name:'Royal Weavers',city:'Jaipur'},
    {id:'SUP-005',name:'Silk Route Co',city:'Varanasi'},
    {id:'SUP-006',name:'Cotton King',city:'Coimbatore'},
    {id:'SUP-007',name:'Linen House',city:'Kolkata'},
    {id:'SUP-008',name:'Style India',city:'Delhi'},
    {id:'SUP-009',name:'Trendy Threads',city:'Pune'},
    {id:'SUP-010',name:'Fashion Hub',city:'Bengaluru'}
  ];
  const WAREHOUSES = [
    {id:'WH-01',name:'Main Warehouse',city:'Ahmedabad'},
    {id:'WH-02',name:'North Hub',city:'Surat'},
    {id:'WH-03',name:'South Hub',city:'Vadodara'},
    {id:'WH-04',name:'East Depot',city:'Rajkot'},
    {id:'WH-05',name:'West Store',city:'Bhavnagar'}
  ];

  function rnd(arr)       { return arr[Math.floor(Math.random() * arr.length)]; }
  function rndInt(a,b)    { return Math.floor(Math.random() * (b - a + 1)) + a; }
  function pad(n,len=3)   { return String(n).padStart(len,'0'); }
  function dateBack(days) {
    const d = new Date(); d.setDate(d.getDate() - days);
    return d.toISOString().slice(0,10);
  }

  // ── Generate 100 Racks ────────────────────────────────────────────────────
  const racks = [];
  let rackNum = 1;
  ZONES.forEach(zone => {
    for (let aisle = 1; aisle <= 4; aisle++) {
      for (let r = 1; r <= 5; r++) {
        const cap      = rndInt(20, 100);
        const occupied = rndInt(0, cap);
        const pct      = Math.round((occupied / cap) * 100);
        racks.push({
          id:        `RACK-${pad(rackNum++)}`,
          zone,
          aisle:     `${zone}${pad(aisle,2)}`,
          name:      `${zone}${pad(aisle,2)}-R${pad(r,2)}`,
          shelf:     `S${rndInt(1,5)}`,
          bin:       `B${rndInt(1,10)}`,
          capacity:  cap,
          occupied,
          available: cap - occupied,
          pct,
          status:    pct === 0 ? 'vacant' : pct < 50 ? 'low' : pct < 85 ? 'partial' : 'full',
          warehouse: rnd(WAREHOUSES).id,
          type:      rnd(['Standard','Heavy Duty','Cold Storage','Pallet']),
          items:     []
        });
      }
    }
  });

  // ── Generate 500 Inventory Items ──────────────────────────────────────────
  const items = [];
  for (let i = 1; i <= 500; i++) {
    const cat      = rnd(CATS);
    const brand    = rnd(BRANDS);
    const color    = rnd(COLORS);
    const size     = rnd(SIZES);
    const rack     = rnd(racks);
    const sup      = rnd(SUPPLIERS);
    const wh       = WAREHOUSES.find(w => w.id === rack.warehouse) || WAREHOUSES[0];
    const qty      = rndInt(0, 200);
    const reserved = Math.min(rndInt(0, 30), qty);
    const pp       = rndInt(200, 2000);
    const sp       = Math.round(pp * (1 + rndInt(20, 80) / 100));

    const item = {
      id:           `ITM-${pad(i,5)}`,
      barcode:      `BC${rndInt(1000000000, 9999999999)}`,
      sku:          `${brand.slice(0,3).toUpperCase()}-${cat.slice(0,3).toUpperCase()}-${pad(i,4)}`,
      name:         `${brand} ${cat} ${color} ${size}`,
      category:     cat,
      brand,
      color,
      size,
      unit:         rnd(UNITS),
      qty,
      reserved,
      available:    qty - reserved,
      purchasePrice: pp,
      sellingPrice:  sp,
      warehouse:    wh.id,
      warehouseName:wh.name,
      zone:         rack.zone,
      aisle:        rack.aisle,
      rack:         rack.name,
      rackId:       rack.id,
      shelf:        rack.shelf,
      bin:          rack.bin,
      supplier:     sup.id,
      supplierName: sup.name,
      status:       qty === 0 ? 'Out of Stock' : qty < 10 ? 'Low Stock' : rnd(['Active','Active','Active','Discontinued']),
      addedDate:    dateBack(rndInt(1,365)),
      image:        `https://placehold.co/80x80/0191D0/ffffff?text=${cat.slice(0,2).toUpperCase()}`,
      description:  `${brand} ${cat} in ${color}, Size ${size}. Premium quality textile product.`,
    };
    items.push(item);
    // add item ref to rack
    rack.items.push(item.id);
  }

  // ── Generate Movement History ─────────────────────────────────────────────
  const movements = [];
  for (let i = 1; i <= 300; i++) {
    const item   = rnd(items);
    const fromR  = rnd(racks);
    const toR    = rnd(racks);
    movements.push({
      id:        `MOV-${pad(i,5)}`,
      itemId:    item.id,
      itemName:  item.name,
      fromRack:  fromR.name,
      toRack:    toR.name,
      qty:       rndInt(1, 20),
      reason:    rnd(REASONS),
      movedBy:   rnd(['Raj Kumar','Priya Patel','Amit Shah','Suresh Joshi','Neha Modi']),
      date:      dateBack(rndInt(0,90)),
      status:    rnd(['Completed','Completed','Completed','Pending'])
    });
  }

  // ── Generate Receiving History ────────────────────────────────────────────
  const receivings = [];
  for (let i = 1; i <= 200; i++) {
    const item = rnd(items);
    const sup  = rnd(SUPPLIERS);
    receivings.push({
      id:          `RCV-${pad(i,5)}`,
      itemId:      item.id,
      itemName:    item.name,
      sku:         item.sku,
      qty:         rndInt(10, 100),
      supplier:    sup.name,
      purchasePrice: item.purchasePrice,
      receivedBy:  rnd(['Raj Kumar','Priya Patel','Amit Shah','Suresh Joshi']),
      date:        dateBack(rndInt(0,60)),
      rack:        item.rack,
      status:      'Completed'
    });
  }

  // ── Notifications ─────────────────────────────────────────────────────────
  const notifications = [
    {id:1, type:'warning',  icon:'triangle-exclamation', title:'Low Stock Alert',     msg:'Florina Kurti Red M — only 3 units left',      time:'2 min ago',  read:false},
    {id:2, type:'danger',   icon:'circle-xmark',         title:'Rack Full',           msg:'Zone A, Aisle A01-R03 is at 100% capacity',    time:'15 min ago', read:false},
    {id:3, type:'success',  icon:'circle-check',         title:'Items Received',      msg:'150 units received from Florina Textiles',     time:'1 hr ago',   read:false},
    {id:4, type:'info',     icon:'arrows-rotate',        title:'Item Moved',          msg:'Vastra Salwar Kameez moved to Zone B-R04',     time:'2 hr ago',   read:true},
    {id:5, type:'warning',  icon:'triangle-exclamation', title:'Rack Almost Full',    msg:'Zone C, Aisle C02-R01 at 88% capacity',        time:'3 hr ago',   read:true},
    {id:6, type:'info',     icon:'box-open',             title:'New Receiving',       msg:'PO-00123 from Cotton King — 80 pieces',        time:'5 hr ago',   read:true},
    {id:7, type:'success',  icon:'circle-check',         title:'Export Complete',     msg:'Inventory report exported successfully',       time:'Yesterday',  read:true},
    {id:8, type:'danger',   icon:'circle-xmark',         title:'Out of Stock',        msg:'Royal Lehenga Green XL — 0 units remaining',  time:'Yesterday',  read:true},
  ];

  // ── Chart/Trend data ──────────────────────────────────────────────────────
  const last7  = Array.from({length:7}, (_,i)=>{
    const d = new Date(); d.setDate(d.getDate()-6+i);
    return d.toLocaleDateString('en-IN',{weekday:'short'});
  });
  const trendReceived  = [42,55,38,71,60,85,48];
  const trendDispatched = [30,40,28,60,50,70,38];

  window.WMS_DATA = {
    warehouses: WAREHOUSES,
    suppliers:  SUPPLIERS,
    categories: CATS,
    colors:     COLORS,
    sizes:      SIZES,
    zones:      ZONES,
    items,
    racks,
    movements,
    receivings,
    notifications,
    chartLabels:    last7,
    trendReceived,
    trendDispatched,

    // Summary stats
    get totalItems()    { return items.reduce((s,i)=>s+i.qty,0); },
    get lowStockItems() { return items.filter(i=>i.status==='Low Stock').length; },
    get outOfStock()    { return items.filter(i=>i.status==='Out of Stock').length; },
    get occupiedRacks() { return racks.filter(r=>r.pct>=85).length; },
    get vacantRacks()   { return racks.filter(r=>r.pct===0).length; },
    get partialRacks()  { return racks.filter(r=>r.pct>0&&r.pct<85).length; },
    todayReceived:  148,
    todayDispatched: 93,
    unreadNotifs:   3,
  };
})();
