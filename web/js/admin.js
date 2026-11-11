/* admin.js — หน้าแอดมิน: ดูคำสั่งซื้อ คิดราคา ส่งราคาเข้า LINE ลูกค้า ตรวจสลิป อัปเดตสถานะ */
(function () {
  'use strict';
  const R = window.Rice;
  const { esc, icon, money } = R;

  const A = { orders: [], products: [], settings: {}, admin: null, sheetUrl: '', zort: null, filter: 'todo', q: '', pq: '', sel: '', view: 'overview', loadedAt: 0, editQuote: {} };
  const root = document.getElementById('admin');
  const SOUND_KEY = 'rice_admin_sound';
  let sound = R.storage(SOUND_KEY) === true;
  let knownNew = null;
  let timer = null;
  const drafts = {}; // ฟอร์มคิดราคาที่ยังไม่ส่ง ต่อคำสั่งซื้อ

  const isCodWaiting = (o) => o.status === 'confirmed' && o.payMethod === 'cod';
  const FILTERS = [
    { id: 'todo', label: 'ต้องทำ', test: (o) => o.status === 'new' || o.status === 'slip' || o.status === 'paid' || isCodWaiting(o) || o.zortVoidStatus === 'pending', hot: true },
    { id: 'new', label: 'รอแจ้งราคา', test: (o) => o.status === 'new' },
    { id: 'quoted', label: 'รอลูกค้ายืนยัน', test: (o) => o.status === 'quoted' },
    { id: 'pay', label: 'รอชำระ / ตรวจสลิป', test: (o) => o.status === 'slip' || (o.status === 'confirmed' && o.payMethod !== 'cod') },
    { id: 'ship', label: 'รอส่ง / กำลังส่ง', test: (o) => o.status === 'paid' || o.status === 'shipping' || isCodWaiting(o) },
    { id: 'done', label: 'สำเร็จ', test: (o) => o.status === 'done' },
    { id: 'cancelled', label: 'ยกเลิก', test: (o) => o.status === 'cancelled' },
    { id: 'zortvoid', label: 'รอยกเลิกใน ZORT', test: (o) => o.zortVoidStatus === 'pending', hot: true, onlyIfAny: true },
    { id: 'all', label: 'ทั้งหมด', test: () => true },
  ];

  function statusPill(o) {
    let s = R.ADMIN_STATUS[o.status] || { label: o.status, tone: 'blue' };
    if (isCodWaiting(o)) s = { label: o.deliveryMethod === 'pickup' ? 'รอมารับ (เงินสด)' : 'รอส่ง (เงินสด)', tone: 'green' };
    return '<span class="pill tone-' + s.tone + '">' + esc(s.label) + '</span>';
  }
  function ptag(o) {
    const p = R.purposeOf(o.purpose);
    return '<span class="ptag">' + icon(p.icon) + esc(p.label) + '</span>';
  }

  /* =========================================================
   * Render — โครง: เมนูด้านข้าง (sidebar) + หัวหน้า + เนื้อหาแต่ละหน้า
   *   หน้า: overview (ภาพรวม) / orders (คำสั่งซื้อ) / products (สินค้าข้าว) / shop (ข้อมูลร้าน)
   * ========================================================= */

  const VIEWS = {
    overview: { label: 'ภาพรวม', icon: 'grid' },
    orders: { label: 'คำสั่งซื้อ', icon: 'receipt' },
    products: { label: 'สินค้าข้าว', icon: 'rice' },
    shop: { label: 'ข้อมูลร้าน', icon: 'store' },
  };
  const FILTER_ICON = { todo: 'bell', new: 'receipt', quoted: 'chat', pay: 'qr', ship: 'truck', done: 'check', cancelled: 'x', zortvoid: 'alert', all: 'list' };
  const shopName = () => A.settings.SHOP_NAME || 'หจก.บุญมีหาดใหญ่';
  const countOf = (f) => A.orders.filter(f.test).length;
  const filterOf = (id) => FILTERS.find((x) => x.id === id) || FILTERS[0];

  function render() {
    root.innerHTML =
      (R.DEMO ? '<div class="demo-banner"><span>โหมดทดลอง: ปุ่มส่ง LINE จะไม่ส่งจริง</span><span><a href="index.html">เปิดหน้าลูกค้า</a></span></div>' : '') +
      '<div class="shell">' +
      '<nav class="side" id="side" aria-label="เมนูหลัก">' + sideNav() + '</nav>' +
      '<div class="scrim" data-act="nav-close" aria-hidden="true"></div>' +
      '<div class="main">' +
      '<header class="mhead" id="mhead">' + mhead() + '</header>' +
      '<div class="view view-' + A.view + '" id="view">' + viewHtml() + '</div>' +
      '</div></div>';
    root.classList.toggle('show-detail', A.view === 'orders' && !!A.sel);
    stamp();
  }

  /** อัปเดตตัวเลข/รายการโดยไม่ล้างฟอร์มที่กำลังพิมพ์ */
  function renderListOnly() {
    const side = document.getElementById('side');
    if (!side) return render();
    const scroll = side.scrollTop;
    side.innerHTML = sideNav(); side.scrollTop = scroll;
    document.getElementById('mhead').innerHTML = mhead();
    const view = document.getElementById('view');
    if (A.view === 'orders') {
      document.getElementById('fchips').innerHTML = chips();
      document.getElementById('olist').innerHTML = list();
    } else if (!(document.activeElement && view.contains(document.activeElement) && document.activeElement.tagName === 'INPUT')) {
      view.innerHTML = viewHtml();
    }
    stamp();
  }
  function renderDetail() {
    const d = document.getElementById('detail');
    if (!d) return;
    d.innerHTML = detail();
    root.classList.toggle('show-detail', !!A.sel);
    document.querySelectorAll('.o-row').forEach((r) => r.classList.toggle('active', r.dataset.id === A.sel));
  }
  function stamp() {
    if (!A.loadedAt) return;
    const t = 'อัปเดตล่าสุด ' + R.timeTH(new Date(A.loadedAt).toISOString()) + ' น.';
    document.querySelectorAll('[data-stamp]').forEach((el) => { el.textContent = t; });
  }
  function syncUrl() {
    history.replaceState(null, '', location.pathname + (A.view === 'orders' && A.sel ? '?order=' + encodeURIComponent(A.sel) : '') + '#' + A.view + (A.view === 'orders' ? '/' + A.filter : ''));
  }
  function go(view, filter) {
    A.view = VIEWS[view] ? view : 'overview';
    if (filter) A.filter = filter;
    if (A.view !== 'orders') A.sel = '';
    root.classList.remove('nav-open');
    syncUrl();
    render();
    window.scrollTo(0, 0);
  }

  /* ---------- เมนูด้านข้าง ---------- */

  function sideNav() {
    const item = (opts) => {
      const on = opts.active;
      const tag = opts.href ? 'a' : 'button';
      const attrs = opts.href ? ' href="' + esc(opts.href) + '" target="_blank" rel="noopener"' : ' type="button" data-act="' + opts.act + '"' + (opts.id ? ' data-id="' + opts.id + '"' : '');
      return '<' + tag + ' class="nav-i' + (on ? ' on' : '') + (opts.cls ? ' ' + opts.cls : '') + '"' + attrs + (on ? ' aria-current="page"' : '') + (opts.pressed !== undefined ? ' aria-pressed="' + opts.pressed + '"' : '') + '>' +
        icon(opts.icon) + '<span class="nav-t">' + opts.label + (opts.sub ? '<small>' + opts.sub + '</small>' : '') + '</span>' +
        (opts.badge !== undefined ? '<span class="nav-n' + (opts.hot ? ' hot' : '') + (opts.alarm ? ' alarm' : '') + '">' + opts.badge + '</span>' : '') +
        (opts.href ? icon('external', 'nav-ext') : '') + (opts.toggle ? '<span class="nav-sw" aria-hidden="true"></span>' : '') +
        '</' + tag + '>';
    };
    const orderItems = FILTERS.map((f) => {
      const n = countOf(f);
      if (f.onlyIfAny && !n && !(A.view === 'orders' && A.filter === f.id)) return '';
      return item({ act: 'filter', id: f.id, icon: FILTER_ICON[f.id] || 'receipt', label: f.label, badge: n, hot: f.hot && n > 0 && f.id !== 'zortvoid', alarm: f.id === 'zortvoid' && n > 0, active: A.view === 'orders' && A.filter === f.id });
    }).join('');
    const z = A.zort || {};
    const last = z.lastSync;
    const activeProducts = A.products.filter((p) => p.active && !(p.stock !== null && p.stock !== undefined && p.stock <= 0)).length;
    const who = (A.admin && A.admin.name) || 'แอดมิน';
    return '<div class="side-brand"><img src="assets/logo-96.png" alt=""><div><b>' + esc(shopName()) + '</b><span>ระบบหลังร้าน</span></div>' +
      '<button type="button" class="side-x" data-act="nav-close" aria-label="ปิดเมนู">' + icon('x') + '</button></div>' +
      '<div class="side-scroll">' +
      '<div class="nav-g">' + item({ act: 'view', id: 'overview', icon: 'grid', label: 'ภาพรวม', active: A.view === 'overview' }) + '</div>' +
      '<div class="nav-g"><div class="nav-h">คำสั่งซื้อ</div>' + orderItems + '</div>' +
      '<div class="nav-g"><div class="nav-h">สินค้า</div>' +
      item({ act: 'view', id: 'products', icon: 'rice', label: 'สินค้าข้าว', badge: activeProducts, active: A.view === 'products' }) +
      (!R.DEMO ? item({ act: 'zort', icon: 'refresh', label: 'ดึงสินค้าจาก ZORT', sub: last ? 'ล่าสุด ' + R.dateTH(last.at, true) : 'ยังไม่เคยดึง' }) : '') +
      (z.imageFolderUrl ? item({ href: z.imageFolderUrl, icon: 'image', label: 'โฟลเดอร์รูปสินค้า' }) : '') +
      '</div>' +
      '<div class="nav-g"><div class="nav-h">ร้านและเครื่องมือ</div>' +
      item({ act: 'view', id: 'shop', icon: 'store', label: 'ข้อมูลร้าน', active: A.view === 'shop' }) +
      (A.sheetUrl ? item({ href: A.sheetUrl, icon: 'sheet', label: 'Google Sheet' }) : '') +
      item({ act: 'csv', icon: 'download', label: 'ดาวน์โหลด CSV', sub: 'ตามรายการที่กรองอยู่' }) +
      item({ act: 'sound', icon: 'bell', label: 'เสียงเตือนออเดอร์ใหม่', toggle: true, pressed: sound, cls: 'nav-toggle' }) +
      '</div></div>' +
      '<div class="side-foot"><span class="side-av">' + esc(who.trim().charAt(0) || 'A') + '</span>' +
      '<div class="side-who"><b>' + esc(who) + '</b><span data-stamp></span></div>' +
      '<button type="button" class="side-refresh" data-act="refresh" aria-label="รีเฟรชข้อมูล" title="รีเฟรชข้อมูล">' + icon('refresh') + '</button></div>';
  }

  /* ---------- หัวหน้า ---------- */

  function mhead() {
    let title = VIEWS[A.view].label, sub = '';
    if (A.view === 'overview') {
      title = 'ภาพรวมวันนี้';
      sub = new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    } else if (A.view === 'orders') {
      const f = filterOf(A.filter);
      title = 'คำสั่งซื้อ · ' + f.label;
      sub = countOf(f) + ' รายการ';
    } else if (A.view === 'products') {
      const l = A.zort && A.zort.lastSync;
      sub = A.products.length + ' รายการ' + (l ? ' · ดึงจาก ZORT ล่าสุด ' + R.dateTH(l.at, true) : '');
    } else sub = 'ข้อมูลที่ลูกค้าเห็นในหน้าสั่งข้าว';
    const todo = countOf(FILTERS[0]);
    return '<button type="button" class="mh-menu" data-act="nav-open" aria-label="เปิดเมนู">' + icon('menu') + (todo ? '<i class="mh-dot">' + todo + '</i>' : '') + '</button>' +
      '<div class="mh-title"><h1>' + esc(title) + '</h1>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div>' +
      '<div class="mh-right"><span class="mh-stamp" data-stamp></span>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="refresh">' + icon('refresh') + '<span>รีเฟรช</span></button></div>';
  }

  function viewHtml() {
    if (A.view === 'orders') return ordersView();
    if (A.view === 'products') return productsView();
    if (A.view === 'shop') return shopView();
    return overviewView();
  }

  /* ---------- หน้า: ภาพรวม ---------- */

  function overviewView() {
    const now = new Date();
    const month = A.orders.filter((o) => { const d = new Date(o.createdAt); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
    const today = A.orders.filter((o) => new Date(o.createdAt).toDateString() === now.toDateString());
    const sold = month.filter((o) => ['paid', 'shipping', 'done'].indexOf(o.status) >= 0);
    const sales = sold.reduce((s, o) => s + (o.total || 0), 0);
    const bags = sold.reduce((s, o) => s + (o.totalBags || 0), 0);
    const kg = sold.reduce((s, o) => s + (o.totalKg || 0), 0);
    const c = (id) => countOf(filterOf(id));
    const zv = c('zortvoid');
    const card = (id, n, label, hint, ic, tone) =>
      '<button type="button" class="stat' + (n ? ' ' + tone : '') + '" data-act="filter" data-id="' + id + '">' +
      '<span class="stat-ic">' + icon(ic) + '</span><span class="stat-b"><b>' + n + '</b><span>' + label + '</span><small>' + hint + '</small></span>' +
      icon('chevron', 'stat-go') + '</button>';

    const mix = {}; month.filter((o) => o.status !== 'cancelled').forEach((o) => { mix[o.purpose] = (mix[o.purpose] || 0) + 1; });
    const totalMix = Object.values(mix).reduce((a, b) => a + b, 0);

    const todo = A.orders.filter(FILTERS[0].test).slice(0, 6);
    const z = A.zort || {};
    const last = z.lastSync;

    return (zv ? '<button type="button" class="ov-alarm" data-act="filter" data-id="zortvoid">' + icon('alert') +
        '<span><b>มี ' + zv + ' รายการที่ต้องไปยกเลิกในระบบ ZORT</b><small>ลูกค้ายกเลิกหลังบันทึกยอดขายเข้า ZORT แล้ว — กดเพื่อดูรายการ</small></span>' + icon('chevron') + '</button>' : '') +
      '<div class="ov-sec-h"><h2>งานที่รอคุณ</h2><span>กดการ์ดเพื่อเปิดรายการ</span></div>' +
      '<div class="stats">' +
      card('new', c('new'), 'รอแจ้งราคา', 'ลูกค้าส่งรายการมาแล้ว', 'receipt', 'hot') +
      card('pay', c('pay'), 'รอชำระ / ตรวจสลิป', 'ตรวจยอดเงินแล้วกดยืนยัน', 'qr', 'hot') +
      card('ship', c('ship'), 'รอส่ง / กำลังส่ง', 'จัดข้าวและส่งให้ลูกค้า', 'truck', 'hot') +
      card('quoted', c('quoted'), 'รอลูกค้ายืนยัน', 'ส่งราคาไปแล้ว รอตอบ', 'chat', 'calm') +
      '</div>' +
      '<div class="ov-grid">' +
      '<section class="panel ov-todo"><div class="panel-h"><h3>' + icon('bell') + 'ต้องทำตอนนี้</h3>' +
      '<button type="button" class="link-btn" data-act="filter" data-id="todo">ดูทั้งหมด (' + c('todo') + ')' + icon('chevron') + '</button></div>' +
      (todo.length ? '<div class="mini-list">' + todo.map((o) =>
        '<button type="button" class="mini" data-act="open" data-id="' + esc(o.orderId) + '">' +
        '<span class="mini-av">' + esc(String(o.fullName || o.lineName || '?').trim().charAt(0)) + '</span>' +
        '<span class="mini-b"><b>' + esc(o.fullName || o.lineName) + '</b><small>#' + esc(o.orderId) + ' · ' + o.totalBags + ' ถุง · ' + R.ago(o.createdAt) + '</small></span>' +
        statusPill(o) + '</button>').join('') + '</div>'
        : '<div class="empty-ok">' + icon('check') + '<b>ไม่มีงานค้าง</b><span>คำสั่งซื้อใหม่จะแสดงที่นี่ทันที</span></div>') +
      '</section>' +
      '<div class="ov-side">' +
      '<section class="panel sales"><div class="panel-h"><h3>' + icon('cash') + 'ยอดขายเดือนนี้</h3></div>' +
      '<div class="sales-big">฿' + money(sales) + '</div>' +
      '<div class="sales-row"><span><b>' + sold.length + '</b>คำสั่งซื้อ</span><span><b>' + bags + '</b>ถุง</span><span><b>' + money(kg) + '</b>กก.</span><span><b>' + today.length + '</b>สั่งวันนี้</span></div>' +
      '<p class="muted small">นับเฉพาะที่ได้รับเงินแล้ว / กำลังส่ง / สำเร็จ</p></section>' +
      '<section class="panel"><div class="panel-h"><h3>' + icon('user') + 'ลูกค้าซื้อไปทำอะไร</h3><span class="muted small">เดือนนี้ ' + totalMix + ' รายการ</span></div>' +
      '<div class="mix-bar">' + (totalMix ? R.PURPOSES.map((p) => mix[p.id] ? '<i class="mx-' + p.id + '" style="width:' + (mix[p.id] / totalMix * 100) + '%" title="' + p.label + ' ' + mix[p.id] + '"></i>' : '').join('') : '') + '</div>' +
      '<ul class="mix-legend">' + R.PURPOSES.map((p) => '<li><i class="mx-' + p.id + '"></i><span>' + p.label + '</span><b>' + (mix[p.id] || 0) + '</b></li>').join('') + '</ul></section>' +
      '<section class="panel"><div class="panel-h"><h3>' + icon('refresh') + 'ระบบ ZORT</h3>' +
      '<span class="pill tone-' + (z.configured ? 'green' : 'done') + '">' + (z.configured ? 'เชื่อมแล้ว' : 'ยังไม่ตั้งค่า') + '</span></div>' +
      '<dl class="kv kv-tight"><dt>ดึงสินค้าล่าสุด</dt><dd>' + (last ? R.dateTH(last.at, true) + ' (' + last.fetched + ' รายการ)' : '-') + '</dd>' +
      '<dt>บันทึกยอดขาย</dt><dd>' + (z.pushOrders ? 'อัตโนมัติเมื่อปิดการขาย' : 'ปิดอยู่') + '</dd></dl>' +
      (!R.DEMO ? '<button type="button" class="btn btn-ghost btn-sm" style="margin-top:.7rem" data-act="zort">' + icon('refresh') + ' ดึงสินค้าจาก ZORT</button>' : '') +
      '</section></div></div>';
  }

  /* ---------- หน้า: คำสั่งซื้อ ---------- */

  function chips() {
    return FILTERS.map((f) => {
      const n = countOf(f);
      if (f.onlyIfAny && !n && A.filter !== f.id) return '';
      return '<button type="button" class="fchip' + (f.hot && n ? ' hot' : '') + '" data-act="filter" data-id="' + f.id + '" aria-pressed="' + (A.filter === f.id) + '">' + f.label + ' <b>' + n + '</b></button>';
    }).join('');
  }

  function ordersView() {
    return '<div class="orders">' +
      '<aside class="list-pane" aria-label="รายการคำสั่งซื้อ">' +
      '<div class="fchips" id="fchips">' + chips() + '</div>' +
      '<div class="search">' + icon('search') + '<input type="search" id="q" placeholder="ค้นหา เลขที่ ชื่อ เบอร์โทร" value="' + esc(A.q) + '" aria-label="ค้นหาคำสั่งซื้อ"></div>' +
      '<div class="o-list" id="olist">' + list() + '</div></aside>' +
      '<section class="detail-pane" id="detail">' + detail() + '</section></div>';
  }

  function visibleOrders() {
    const f = filterOf(A.filter);
    const q = A.q.trim().toLowerCase();
    return A.orders.filter(f.test).filter((o) => !q ||
      [o.orderId, o.fullName, o.lineName, o.phone, o.purposeNote, o.address].join(' ').toLowerCase().indexOf(q) >= 0 ||
      String(o.phone || '').indexOf(q.replace(/\D/g, '') || '¤') >= 0);
  }

  function list() {
    const rows = visibleOrders();
    if (!rows.length) return '<div class="o-empty">' + icon(A.filter === 'todo' ? 'check' : 'receipt') + '<b>' + (A.q ? 'ไม่พบคำสั่งซื้อที่ค้นหา' : A.filter === 'todo' ? 'ไม่มีงานค้าง เยี่ยมมาก' : 'ไม่มีคำสั่งซื้อในกลุ่มนี้') + '</b></div>';
    return rows.map((o) =>
      '<button type="button" class="o-row' + (o.orderId === A.sel ? ' active' : '') + (o.status === 'new' ? ' is-new' : '') + '" data-act="open" data-id="' + esc(o.orderId) + '">' +
      '<div class="o-row-top"><b>#' + esc(o.orderId) + '</b>' + statusPill(o) + '</div>' +
      (o.zortVoidStatus === 'pending' ? '<div class="o-row-flag">' + icon('alert') + 'ต้องไปยกเลิกใน ZORT</div>' : '') +
      '<div class="o-row-name">' + esc(o.fullName || o.lineName) + '</div>' +
      '<div class="o-row-meta"><span>' + ptag(o) + ' ' + o.totalBags + ' ถุง / ' + o.totalKg + ' กก.</span><span>' + (o.total ? '฿' + money(o.total) : R.ago(o.createdAt)) + '</span></div>' +
      '</button>').join('');
  }

  /* ---------- หน้า: สินค้าข้าว ---------- */

  function productRows() {
    const q = A.pq.trim().toLowerCase();
    const rows = A.products.filter((p) => !q || [p.name, p.sku, p.category, p.unit, p.sizeKg + ' กก'].join(' ').toLowerCase().indexOf(q) >= 0);
    if (!rows.length) return '<div class="o-empty">' + icon('rice') + '<b>' + (A.products.length ? 'ไม่พบสินค้าที่ค้นหา' : 'ยังไม่มีสินค้า — กด "ดึงสินค้าจาก ZORT"') + '</b></div>';
    return rows.map((p) => {
      const stock = p.stock === null || p.stock === undefined ? '<span class="muted">-</span>' : p.stock > 0 ? '<b>' + p.stock + '</b>' : '<span class="pill tone-red">หมด</span>';
      return '<div class="p-row' + (p.active ? '' : ' off') + '">' +
        '<span class="p-img">' + (p.image ? '<img src="' + esc(p.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : R.sackLoader('2.4rem')) + '</span>' +
        '<span class="p-name"><b>' + esc(p.name) + '</b><small>' + esc([p.sku && 'SKU ' + p.sku, p.category].filter(Boolean).join(' · ') || '-') + '</small></span>' +
        '<span class="p-size">' + (p.sizeKg ? p.sizeKg + ' กก.' : '-') + ' / ' + esc(p.unit) + '</span>' +
        '<span class="p-price"><b>฿' + money(p.price) + '</b>' + (p.priceWholesale ? '<small>ส่ง ฿' + money(p.priceWholesale) + '</small>' : '') + '</span>' +
        '<span class="p-stock">' + stock + '</span>' +
        '<span class="p-st">' + (!p.active ? '<span class="pill tone-done">ซ่อน</span>'
          : p.stock !== null && p.stock !== undefined && p.stock <= 0 ? '<span class="pill tone-done" title="ลูกค้าจะเห็นอีกครั้งเมื่อสต็อกใน ZORT มีของ">ไม่แสดง (หมด)</span>'
          : '<span class="pill tone-green">ขายอยู่</span>') + '</span>' +
        '</div>';
    }).join('');
  }

  function productsView() {
    const z = A.zort || {};
    const noImg = A.products.filter((p) => !p.image).length;
    return '<div class="toolbar">' +
      '<div class="search grow">' + icon('search') + '<input type="search" id="pq" placeholder="ค้นหาชื่อข้าว SKU หมวด ขนาด" value="' + esc(A.pq) + '" aria-label="ค้นหาสินค้า"></div>' +
      (!R.DEMO ? '<button type="button" class="btn btn-primary btn-sm" data-act="zort">' + icon('refresh') + ' ดึงสินค้าจาก ZORT</button>' : '') +
      (z.imageFolderUrl ? '<a class="btn btn-ghost btn-sm" href="' + esc(z.imageFolderUrl) + '" target="_blank" rel="noopener">' + icon('image') + ' โฟลเดอร์รูป</a>' : '') +
      '</div>' +
      (noImg ? '<p class="hint-line">' + icon('image') + 'ยังไม่มีรูป ' + noImg + ' รายการ — กด "ดึงสินค้าจาก ZORT" ระบบจะค้นรูปตามชื่อสินค้าให้ หรือวางรูปในโฟลเดอร์รูปสินค้า</p>' : '') +
      '<div class="panel p-table"><div class="p-head"><span></span><span>สินค้า</span><span>ขนาด</span><span>ราคาปลีก / ส่ง</span><span>สต็อก</span><span>สถานะ</span></div>' +
      '<div id="prows">' + productRows() + '</div></div>' +
      '<p class="muted small" style="margin-top:.7rem">แก้ชื่อ ราคา สต็อก ในระบบ ZORT แล้วกด "ดึงสินค้าจาก ZORT" — ราคาส่งและลำดับแก้ได้ในแท็บ Products ของ Google Sheet</p>';
  }

  /* ---------- หน้า: ข้อมูลร้าน ---------- */

  function shopView() {
    const s = A.settings;
    const z = A.zort || {};
    const yes = (v) => /^(true|1|yes)$/i.test(String(v));
    const row = (k, v) => '<dt>' + k + '</dt><dd>' + (v === '' || v === undefined || v === null ? '<span class="muted">ยังไม่ได้ตั้ง</span>' : v) + '</dd>';
    const phones = R.phoneList(s.SHOP_PHONE).map((d) => '<a href="tel:' + d + '">' + esc(R.phoneFmt(d)) + '</a>').join(', ');
    return '<div class="shop-grid">' +
      '<section class="panel"><div class="panel-h"><h3>' + icon('store') + 'ข้อมูลร้าน</h3></div><dl class="kv">' +
      row('ชื่อร้าน', esc(s.SHOP_NAME || '')) + row('โทร', phones) + row('ที่อยู่', esc(s.SHOP_ADDRESS || '')) +
      row('เวลาทำการ', esc(s.SHOP_HOURS || '')) + row('เลขผู้เสียภาษี', esc(s.SHOP_TAX_ID || '')) +
      row('แจ้งราคา', esc(s.QUOTE_TIME || '')) + '</dl></section>' +
      '<section class="panel"><div class="panel-h"><h3>' + icon('qr') + 'การรับเงิน</h3></div><dl class="kv">' +
      row('พร้อมเพย์', esc(s.PROMPTPAY_ID || '')) + row('ชื่อบัญชี', esc(s.PROMPTPAY_NAME || '')) +
      row('บัญชีอื่น', esc(s.BANK_INFO || '')) + row('รับเงินสด', yes(s.ALLOW_COD) ? 'รับ (ตอนส่ง / ตอนมารับ)' : 'ไม่รับ') + '</dl></section>' +
      '<section class="panel"><div class="panel-h"><h3>' + icon('truck') + 'การจัดส่ง</h3></div><dl class="kv">' +
      row('ค่าส่งเริ่มต้น', '฿' + money(Number(s.SHIP_BASE) || 0)) + row('ต่อกิโลเมตร', '฿' + money(Number(s.SHIP_PER_KM) || 0)) +
      row('ส่งฟรีเมื่อครบ', Number(s.FREE_SHIP_BAGS) ? s.FREE_SHIP_BAGS + ' ถุง' : 'ไม่มี') + '</dl></section>' +
      '<section class="panel"><div class="panel-h"><h3>' + icon('refresh') + 'การเชื่อมต่อ</h3></div><dl class="kv">' +
      row('ZORT', z.configured ? '<span class="pill tone-green">เชื่อมแล้ว</span>' : '<span class="pill tone-done">ยังไม่ตั้งค่า</span>') +
      row('บันทึกยอดขาย', z.pushOrders ? 'อัตโนมัติเมื่อปิดการขาย' : 'ปิดอยู่') +
      row('แจ้งเตือนแอดมิน', yes(s.ADMIN_NOTIFY) ? 'ส่ง LINE เมื่อมีคำสั่งซื้อใหม่' : 'ปิดอยู่') +
      row('ค้นรูปสินค้า', yes(s.WEB_IMAGE_SEARCH === undefined ? 'TRUE' : s.WEB_IMAGE_SEARCH) ? 'เปิด (ตามชื่อสินค้า)' : 'ปิดอยู่') + '</dl></section>' +
      '</div>' +
      '<div class="panel edit-note">' + icon('sheet') + '<div><b>ต้องการแก้ข้อมูลร้าน?</b><span>แก้ได้ที่แท็บ <b>Settings</b> ใน Google Sheet แล้วกดรีเฟรช หน้าลูกค้าจะอัปเดตภายใน 1 นาที</span></div>' +
      (A.sheetUrl ? '<a class="btn btn-primary btn-sm" href="' + esc(A.sheetUrl) + '" target="_blank" rel="noopener">เปิด Google Sheet</a>' : '') + '</div>';
  }

  /* ---------- รายละเอียดคำสั่งซื้อ ---------- */

  function detail() {
    const o = A.orders.find((x) => x.orderId === A.sel);
    if (!o) return '<div class="d-empty"><div>' + icon('receipt') + '<p><b>เลือกคำสั่งซื้อ</b><br>กดรายการทางซ้ายเพื่อดูรายละเอียด แจ้งราคา และอัปเดตสถานะ</p></div></div>';
    const c = o.customer || {};
    const p = R.purposeOf(o.purpose);
    const map = R.mapUrl(o.lat, o.lng);
    const tel = 'tel:' + String(o.phone || '').replace(/\D/g, '');
    const initial = esc(String(o.fullName || o.lineName || '?').trim().charAt(0));

    const items = o.items || [];
    const unitSum = {};
    items.forEach((i) => { unitSum[i.unit] = (unitSum[i.unit] || 0) + (Number(i.qty) || 0); });
    const unitText = Object.keys(unitSum).map((u) => unitSum[u] + ' ' + u).join(' + ') || '-';
    const isDelivery = o.deliveryMethod !== 'pickup';
    const repeat = c.orderCount > 1;
    const imgOf = (i) => i.image || ((A.products.find((x) => x.id === i.productId) || {}).image) || '';

    const itemsRows = items.map((i) => {
      const img = imgOf(i);
      return '<li class="it">' +
        '<span class="it-img">' + (img ? '<img src="' + esc(img) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : R.sackLoader('2.2rem')) + '</span>' +
        '<span class="it-b"><b>' + esc(i.name) + '</b><small>' + (i.sizeKg ? i.sizeKg + ' กก. / ' : '') + esc(i.unit) + (i.detail ? ' · ' + esc(i.detail) : '') + '</small></span>' +
        '<span class="it-q"><b>× ' + i.qty + '</b><small>' + esc(i.unit) + '</small></span>' +
        '<span class="it-kg">' + money((Number(i.qty) || 0) * (Number(i.sizeKg) || 0)) + ' กก.</span></li>';
    }).join('');

    const row = (ic, label, val) => '<li><span class="ci-ic">' + icon(ic) + '</span><span class="ci-l">' + label + '</span><span class="ci-v">' + val + '</span></li>';

    const custCard = '<section class="card cust-card"><h3>' + icon('user') + 'ลูกค้า</h3>' +
      '<div class="cust"><span class="avatar">' + (c.linePicture ? '<img src="' + esc(c.linePicture) + '" alt="" referrerpolicy="no-referrer">' : initial) + '</span>' +
      '<div class="cust-b"><strong>' + esc(o.fullName || o.lineName || '-') + '</strong>' +
      '<span class="cust-line">LINE: ' + esc(o.lineName || '-') + '</span>' +
      '<span class="cust-badge ' + (repeat ? 'old' : 'new') + '">' + icon(repeat ? 'repeat' : 'user') + (repeat ? 'ลูกค้าประจำ · สั่งครั้งที่ ' + c.orderCount : 'ลูกค้าใหม่') + '</span></div></div>' +
      '<ul class="cinfo">' +
      row('phone', 'โทร', o.phone ? '<a href="' + tel + '">' + esc(R.phoneFmt(o.phone)) + '</a>' : '-') +
      row(p.icon, 'ซื้อไป', '<span class="purpose-hl">' + esc(p.label) + '</span>' + (o.purposeNote ? '<span class="ci-note">' + esc(o.purposeNote) + '</span>' : '')) +
      row(isDelivery ? 'truck' : 'store', 'รับข้าว', isDelivery
        ? 'ส่งถึงที่' + (o.address ? '<span class="ci-note">' + esc(o.address) + '</span>' : '<span class="ci-warn">' + icon('alert') + 'ยังไม่มีที่อยู่ — โทรสอบถามลูกค้า</span>')
        : 'มารับเองที่ร้าน') +
      (isDelivery && o.distanceKm != null ? row('map', 'ระยะทาง', '~' + o.distanceKm + ' กม. จากร้าน <span class="muted">(เส้นตรง)</span>') : '') +
      (o.wantDate ? row('calendar', 'ต้องการรับ', esc(o.wantDate)) : '') +
      (o.note ? row('chat', 'หมายเหตุ', '<span class="ci-memo">' + esc(o.note) + '</span>') : '') +
      '</ul><div class="cust-acts">' +
      (o.phone ? '<a class="btn btn-primary btn-sm" href="' + tel + '">' + icon('phone') + ' โทรหาลูกค้า</a>' : '') +
      (map ? '<a class="btn btn-ghost btn-sm" href="' + map + '" target="_blank" rel="noopener">' + icon('map') + ' เปิดแผนที่</a>' : '') +
      '</div></section>';
    const itemsCard = '<section class="card items-card"><h3>' + icon('receipt') + 'รายการที่สั่ง <span class="h3-n">' + items.length + ' รายการ</span></h3>' +
      '<ul class="it-list">' + itemsRows + '</ul>' +
      '<div class="it-sum"><span>รวมทั้งหมด</span><b>' + esc(unitText) + '</b><b class="kg">' + money(o.totalKg) + ' กก.</b></div></section>';

    const brief = '<span class="ob-who">' + esc(o.fullName || o.lineName || '-') + '</span>' +
      (o.phone ? '<a class="ob-tel" href="' + tel + '">' + icon('phone') + esc(R.phoneFmt(o.phone)) + '</a>' : '') +
      '<span class="ob-items">' + icon('rice') + esc(items.map((i) => i.name + ' × ' + i.qty + ' ' + i.unit).join(', ')) + '</span>';
    const orderInfo = '<details class="ord-info"' + (o.status === 'new' ? ' open' : '') + '><summary><span class="ob">' + brief + '</span>' +
      '<span class="ob-more"><span class="t-open">ดูข้อมูลลูกค้าและรายการ</span><span class="t-close">ซ่อน</span>' + icon('chevron') + '</span></summary>' +
      '<div class="d-grid">' + custCard + itemsCard + '</div></details>';
    const contact = '<div class="ship-to">' + icon(isDelivery ? 'pin' : 'store') + '<div><b>' + esc(o.fullName || o.lineName || '-') + '</b>' +
      '<span>' + (isDelivery ? (o.address ? esc(o.address) : 'ยังไม่มีที่อยู่ — โทรสอบถามลูกค้า') : 'มารับเองที่ร้าน') + '</span></div>' +
      '<div class="ship-acts">' + (o.phone ? '<a class="btn btn-ghost btn-sm" href="' + tel + '">' + icon('phone') + ' โทร</a>' : '') +
      (map && isDelivery ? '<a class="btn btn-ghost btn-sm" href="' + map + '" target="_blank" rel="noopener">' + icon('map') + ' แผนที่</a>' : '') + '</div></div>';
    const steps = flowSteps(o, orderInfo, contact);
    const cur = steps.findIndex((x) => x.state === 'now');
    const doneN = steps.filter((x) => x.state === 'done').length;
    const prog = o.status === 'cancelled'
      ? '<div class="dh-prog cancel">' + icon('x') + '<span><b>ยกเลิกแล้ว</b>' + (o.cancelReason ? ' — ' + esc(o.cancelReason) : '') + '</span></div>'
      : '<div class="dh-prog"><div class="pg-bar"><i style="width:' + Math.round(doneN / steps.length * 100) + '%"></i></div>' +
        '<span>' + (cur >= 0 ? 'ขั้นตอนที่ <b>' + (cur + 1) + '</b> จาก ' + steps.length + ' · <b>' + esc(steps[cur].title) + '</b>' : '<b>ครบทุกขั้นตอนแล้ว</b>') + '</span></div>';

    return '<div class="d-hero">' +
      '<button type="button" class="btn btn-ghost btn-sm d-back" data-act="close">' + icon('back') + ' รายการ</button>' +
      '<div class="dh-main"><span class="dh-k">คำสั่งซื้อ</span>' +
      '<div class="dh-id"><h2>#' + esc(o.orderId) + '</h2>' + statusPill(o) + '</div>' +
      '<span class="dh-time">' + icon('clock') + 'สั่งเมื่อ ' + R.dateTH(o.createdAt, true) + ' · ' + R.ago(o.createdAt) + '</span></div>' +
      '<div class="dh-chips">' +
      '<span class="dh-chip">' + icon('rice') + '<b>' + esc(unitText) + '</b><small>' + money(o.totalKg) + ' กก.</small></span>' +
      '<span class="dh-chip">' + icon(isDelivery ? 'truck' : 'store') + '<b>' + (isDelivery ? 'ส่งถึงที่' : 'มารับที่ร้าน') + '</b><small>' + (isDelivery && o.distanceKm != null ? '~' + o.distanceKm + ' กม.' : isDelivery ? 'จัดส่ง' : 'รับเอง') + '</small></span>' +
      (o.wantDate ? '<span class="dh-chip">' + icon('calendar') + '<b>' + esc(o.wantDate) + '</b><small>ต้องการรับ</small></span>' : '') +
      (o.total ? '<span class="dh-chip money">' + icon('cash') + '<b>฿' + money(o.total) + '</b><small>ยอดรวม</small></span>' : '') +
      '</div>' + prog + '</div>' +
      (o.zortVoidStatus === 'pending' ? zortLine(o) : '') +

      '<ol class="flow">' + steps.map((st, i) =>
        '<li class="fs ' + st.state + '">' +
        '<div class="fs-rail"><span class="fs-dot">' + (st.state === 'done' ? icon('check') : st.state === 'cancel' ? icon('x') : (i + 1)) + '</span></div>' +
        '<div class="fs-main"><div class="fs-h"><div><small>ขั้นตอนที่ ' + (i + 1) + '</small><b>' + esc(st.title) + '</b></div>' +
        '<span class="fs-badge">' + st.badge + '</span></div>' +
        (st.body ? '<div class="fs-body">' + st.body + '</div>' : '') + '</div></li>').join('') + '</ol>' +

      (['done', 'cancelled'].indexOf(o.status) < 0
        ? '<div class="flow-foot"><span>ลูกค้าขอยกเลิก หรือสั่งผิด?</span>' + actBtn(['cancelled', 'ยกเลิกคำสั่งซื้อ', 'danger', { needNote: true, zortWarn: !!o.zortOrderId }], true) + '</div>' : '') +

      '<details class="card hist-card"><summary>' + icon('clock') + '<b>ประวัติการดำเนินการ</b><span class="h3-n">' + (o.history || []).length + ' รายการ · กดเพื่อดู</span></summary><ul class="tline">' +
      (o.history || []).slice().reverse().map((h, i) =>
        '<li class="' + (i === 0 ? 'latest' : '') + '"><span class="tl-dot"></span><div class="tl-b"><b>' + esc((R.ADMIN_STATUS[h.status] || {}).label || h.status) + '</b>' +
        (h.note ? '<p>' + esc(h.note) + '</p>' : '') +
        '<small>' + R.dateTH(h.at, true) + ' · โดย ' + esc(String(h.by || '').replace(/^admin:/, 'แอดมิน ').replace('customer', 'ลูกค้า')) + '</small></div></li>').join('') +
      '</ul></details>';
  }

  function suggestShip(o) {
    const s = A.settings;
    if (o.deliveryMethod === 'pickup') return { fee: 0, why: 'ลูกค้ามารับเอง' };
    const free = Number(s.FREE_SHIP_BAGS) || 0;
    if (free > 0 && o.totalBags >= free) return { fee: 0, why: 'ส่งฟรี (ครบ ' + free + ' ถุง)' };
    const base = Number(s.SHIP_BASE) || 0, perKm = Number(s.SHIP_PER_KM) || 0;
    if (!base && !perKm) return null;
    if (o.distanceKm == null) return { fee: base, why: 'ค่าส่งเริ่มต้น (ไม่ทราบระยะทาง)' };
    return { fee: Math.ceil((base + perKm * o.distanceKm) / 10) * 10, why: '฿' + base + ' + ฿' + perKm + '/กม. × ' + o.distanceKm + ' กม.' };
  }

  function getDraft(o) {
    if (drafts[o.orderId]) return drafts[o.orderId];
    const q = o.quote;
    const sug = suggestShip(o);
    const d = q
      ? { lines: q.lines.map((l) => Object.assign({}, l)), shippingFee: q.shippingFee, discount: q.discount, note: q.note || '' }
      : {
          lines: (o.items || []).map((i) => ({ productId: i.productId, name: i.name, sizeKg: i.sizeKg, unit: i.unit, qty: i.qty, unitPrice: i.refPrice || 0 })),
          shippingFee: sug ? sug.fee : 0, discount: 0, note: '',
        };
    drafts[o.orderId] = d;
    return d;
  }
  function draftTotal(d) {
    const sub = d.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
    return { sub, total: Math.max(0, sub + (Number(d.shippingFee) || 0) - (Number(d.discount) || 0)) };
  }

  function quoteCard(o) {
    const editable = ['new', 'quoted', 'confirmed'].indexOf(o.status) >= 0;
    if (!editable || (o.status !== 'new' && !A.editQuote[o.orderId])) {
      if (!o.quote) return '';
      const q = o.quote;
      return '<section class="card span2 receipt"><h3>' + icon('cash') + 'ราคาที่แจ้งลูกค้า' + (o.quotedAt ? '<span class="h3-n">แจ้งเมื่อ ' + R.dateTH(o.quotedAt, true) + '</span>' : '') + '</h3>' +
        '<div class="rc-lines">' + q.lines.map((l) =>
          '<div class="rc-l"><span><b>' + esc(l.name) + '</b><small>' + l.qty + ' ' + esc(l.unit) + (l.sizeKg ? ' × ' + l.sizeKg + ' กก.' : '') + ' · ฿' + money(l.unitPrice) + '/' + esc(l.unit) + '</small></span><b>฿' + money(l.amount) + '</b></div>').join('') + '</div>' +
        '<div class="sum-rows"><div><span>ราคาสินค้า</span><b>฿' + money(q.subtotal != null ? q.subtotal : q.lines.reduce((x, l) => x + (l.amount || 0), 0)) + '</b></div>' +
        '<div><span>ค่าส่ง</span><b>' + (q.shippingFee ? '฿' + money(q.shippingFee) : 'ฟรี') + '</b></div>' +
        (q.discount ? '<div class="disc"><span>ส่วนลด</span><b>−฿' + money(q.discount) + '</b></div>' : '') + '</div>' +
        '<div class="sum-total"><span>ยอดที่ลูกค้าต้องชำระ</span><b>฿' + money(q.total) + '</b></div>' +
        (q.note ? '<p class="rc-note">' + icon('chat') + esc(q.note) + '</p>' : '') +
        (editable ? '<div class="rc-edit"><button type="button" class="btn btn-ghost btn-sm" data-act="edit-quote">' + icon('other') + ' แก้ราคา แล้วส่งใหม่</button></div>' : '') + '</section>';
    }
    const d = getDraft(o);
    const t = draftTotal(d);
    const sug = suggestShip(o);
    const wholesale = o.purpose === 'restaurant' || o.purpose === 'wholesale';
    const resend = o.status !== 'new';
    const stepH = (n, title, hint) => '<div class="qf-h"><span class="qf-n">' + n + '</span><div><b>' + title + '</b>' + (hint ? '<small>' + hint + '</small>' : '') + '</div></div>';
    return '<section class="card span2 qform" id="quote-card">' +
      '<div class="qf-top"><h3>' + icon('cash') + (resend ? 'แก้ราคา แล้วส่งใหม่' : 'ฟอร์มแจ้งราคา') + '</h3>' +
      (resend ? '<button type="button" class="link-btn" data-act="edit-quote-cancel">ยกเลิกการแก้</button>' : '') +
      '<span class="qf-tier">' + icon('receipt') + 'ราคาตั้งต้น: ' + (wholesale ? 'ราคาส่ง (' + esc(R.purposeOf(o.purpose).label) + ')' : 'ราคาปลีก') + '</span></div>' +
      '<div class="qf-grid"><div class="qf-steps">' +

      '<div class="qf-step">' + stepH(1, 'ตรวจจำนวนและราคาต่อหน่วย', 'แก้ได้ทุกช่อง ราคารวมคำนวณให้อัตโนมัติ') +
      '<div class="ql-head"><span>สินค้า</span><span>จำนวน</span><span>ราคา/หน่วย</span><span>รวม</span></div>' +
      d.lines.map((l, i) =>
        '<div class="ql">' +
        '<span class="ql-name"><b>' + esc(l.name) + '</b>' + (l.sizeKg ? '<small>' + l.sizeKg + ' กก. / ' + esc(l.unit) + '</small>' : '') + '</span>' +
        '<label class="fld"><span class="fld-l">จำนวน</span><span class="inp"><input type="number" min="0" inputmode="numeric" data-q="qty" data-i="' + i + '" value="' + l.qty + '" aria-label="จำนวน ' + esc(l.name) + '"><em>' + esc(l.unit) + '</em></span></label>' +
        '<label class="fld"><span class="fld-l">ราคา/หน่วย</span><span class="inp pre"><i>฿</i><input type="number" min="0" step="0.01" inputmode="decimal" data-q="unitPrice" data-i="' + i + '" value="' + l.unitPrice + '" aria-label="ราคาต่อหน่วย ' + esc(l.name) + '"></span></label>' +
        '<span class="ql-amt" id="amt-' + i + '">฿' + money((Number(l.qty) || 0) * (Number(l.unitPrice) || 0)) + '</span></div>').join('') +
      '</div>' +

      '<div class="qf-step">' + stepH(2, 'ค่าส่งและส่วนลด', o.deliveryMethod === 'pickup' ? 'ลูกค้ามารับเองที่ร้าน' : (o.distanceKm != null ? 'ระยะทางประมาณ ' + o.distanceKm + ' กม. จากร้าน' : '')) +
      '<div class="qf-2">' +
      '<label class="fld"><span class="fld-l">ค่าส่ง</span><span class="inp pre"><i>฿</i><input type="number" min="0" inputmode="decimal" data-q="shippingFee" value="' + d.shippingFee + '"></span>' +
      (sug ? '<span class="sug">' + icon('truck') + 'แนะนำ <b>฿' + money(sug.fee) + '</b> <small>(' + esc(sug.why) + ')</small>' + (Number(d.shippingFee) !== sug.fee ? '<button type="button" data-act="use-ship" data-v="' + sug.fee + '">ใช้ค่านี้</button>' : '') + '</span>' : '') + '</label>' +
      '<label class="fld"><span class="fld-l">ส่วนลด</span><span class="inp pre"><i>฿</i><input type="number" min="0" inputmode="decimal" data-q="discount" value="' + d.discount + '"></span></label>' +
      '</div></div>' +

      '<div class="qf-step">' + stepH(3, 'ข้อความถึงลูกค้า', 'ไม่บังคับ — แสดงใต้ราคาในข้อความ LINE') +
      '<textarea class="txt" rows="2" maxlength="300" data-q="note" placeholder="เช่น ส่งได้พรุ่งนี้เช้า / ลดให้เพราะทำบุญ">' + esc(d.note) + '</textarea></div>' +
      '</div>' +

      '<aside class="qf-sum"><div class="qs-h">สรุปยอด</div>' +
      '<div class="sum-rows"><div><span>ราคาสินค้า</span><b id="q-sub">฿' + money(t.sub) + '</b></div>' +
      '<div><span>ค่าส่ง</span><b id="q-ship">' + (Number(d.shippingFee) ? '฿' + money(d.shippingFee) : 'ฟรี') + '</b></div>' +
      '<div class="disc"><span>ส่วนลด</span><b id="q-disc">' + (Number(d.discount) ? '−฿' + money(d.discount) : '-') + '</b></div></div>' +
      '<div class="sum-total"><span>ยอดที่ลูกค้าต้องชำระ</span><b id="q-total">฿' + money(t.total) + '</b></div>' +
      '<button type="button" class="btn btn-go btn-lg btn-block" data-act="send-quote">' + icon('chat') + (resend ? ' ส่งราคาใหม่ให้ลูกค้า' : ' ส่งราคาให้ลูกค้าทาง LINE') + '</button>' +
      '<p class="qs-note">' + icon('check') + 'ลูกค้าจะได้ข้อความใน LINE พร้อมปุ่มยืนยันราคา</p></aside>' +
      '</div></section>';
  }

  /** ปุ่มเปลี่ยนสถานะ — a = [สถานะใหม่, ข้อความ, แบบปุ่ม, ตัวเลือก] */
  function actBtn(a, link) {
    return '<button type="button" class="' + (link ? 'btn btn-ghost btn-sm danger-link' : 'btn btn-' + a[2]) + '" data-act="status" data-to="' + a[0] + '" data-label="' + esc(a[1]) + '"' +
      (a[3] && a[3].needNote ? ' data-neednote="1"' : '') + (a[3] && a[3].pay ? ' data-pay="1"' : '') + (a[3] && a[3].zortWarn ? ' data-zortwarn="1"' : '') + '>' + esc(a[1]) + '</button>';
  }
  const tip = (t) => '<p class="fs-tip">' + icon('bell') + '<span>' + t + '</span></p>';
  const fact = (t) => '<p class="fs-fact">' + t + '</p>';
  const acts = (list) => '<div class="fs-acts">' + list.map((a) => actBtn(a)).join('') + '</div>';

  /**
   * 6 ขั้นตอนของคำสั่งซื้อ เรียงตามลำดับจริง — แต่ละขั้นมีสถานะ done / now / todo / cancel
   * ปุ่มของแต่ละการกระทำอยู่ในขั้นตอนของมันเอง
   */
  function flowSteps(o, orderInfo, contact) {
    const pickup = o.deliveryMethod === 'pickup';
    const cod = o.payMethod === 'cod';
    const st = o.status;
    const cancelled = st === 'cancelled';
    const idx = { new: 1, quoted: 2, confirmed: cod ? 4 : 3, slip: 3, paid: 4, shipping: 4, done: 6 }[st];
    const reached = (i, at) => cancelled ? (at ? 'done' : 'cancel') : i < idx ? 'done' : i === idx ? 'now' : 'todo';
    const badge = (state, at) => state === 'done' ? icon('check') + (at ? R.dateTH(at, true) : 'เสร็จแล้ว')
      : state === 'now' ? 'ทำขั้นตอนนี้' : state === 'cancel' ? 'ยกเลิก' : 'ยังไม่ถึง';
    const S = [];

    // 1) รับคำสั่งซื้อ
    S.push({ title: 'รับคำสั่งซื้อจากลูกค้า', state: 'done', at: o.createdAt, body: orderInfo });

    // 2) แจ้งราคา
    let s2 = reached(1, o.quotedAt), b2 = '';
    if (s2 === 'now') b2 = tip('ตรวจจำนวน ราคา ค่าส่ง แล้วกด <b>ส่งราคาให้ลูกค้าทาง LINE</b> — ลูกค้าจะได้ข้อความพร้อมปุ่มยืนยัน') + quoteCard(o);
    else if (s2 === 'done' || o.quote) b2 = quoteCard(o);
    else b2 = fact('ยังไม่ได้แจ้งราคา');
    S.push({ title: 'แจ้งราคาให้ลูกค้า', state: s2, at: o.quotedAt, body: b2 });

    // 3) ลูกค้ายืนยันราคา
    const s3 = reached(2, o.confirmedAt);
    let b3 = '';
    if (s3 === 'now') {
      b3 = tip('ส่งราคาแล้ว ' + R.ago(o.quotedAt) + ' — รอลูกค้ากดยืนยันใน LINE ถ้าลูกค้าตกลงทางโทรศัพท์ กดปุ่มด้านล่างแทนได้') +
        acts([['confirmed', 'ลูกค้ายืนยันทางโทรศัพท์', 'ghost', { pay: true }]]);
    } else if (s3 === 'done') {
      b3 = fact('ลูกค้ายืนยันราคา' + (o.payMethod ? ' · เลือก<b>' + (cod ? 'ชำระเงินสดตอนรับสินค้า' : 'โอน / สแกนจ่าย') + '</b>' : ''));
    } else b3 = fact('ลูกค้ากดยืนยันหลังได้รับราคาทาง LINE');
    S.push({ title: 'ลูกค้ายืนยันราคา', state: s3, at: o.confirmedAt, body: b3 });

    // 4) ชำระเงิน
    const s4 = cod && !cancelled ? (st === 'done' ? 'done' : idx > 3 ? 'skip' : reached(3)) : reached(3, o.paidAt);
    let b4 = '';
    if (cod && st !== 'done') {
      b4 = fact('ลูกค้าเลือก<b>ชำระเงินสด ฿' + money(o.total) + '</b> ตอนรับสินค้า — ยืนยันการรับเงินในขั้นตอนถัดไป');
    } else if (s4 === 'now') {
      const slip = o.slipUrl ? '<a class="slip-link" href="' + esc(o.slipUrl) + '" target="_blank" rel="noopener">' + icon('camera') + ' เปิดดูรูปสลิป' + (o.slipAt ? ' (ส่งเมื่อ ' + R.ago(o.slipAt) + ')' : '') + '</a>' : '';
      b4 = st === 'slip'
        ? tip('ลูกค้าส่งสลิปแล้ว — เปิดแอปธนาคาร ตรวจว่าได้รับเงิน <b>฿' + money(o.total) + '</b> จริง แล้วกดยืนยัน') + slip +
          acts([['paid', 'สลิปถูกต้อง ได้รับเงินแล้ว', 'go'], ['confirmed', 'สลิปไม่ถูกต้อง ขอให้ส่งใหม่', 'ghost', { needNote: true }]])
        : tip('รอลูกค้าโอนเงิน <b>฿' + money(o.total) + '</b> และส่งสลิป ถ้าเห็นเงินเข้าแล้ว กดยืนยันได้เลย') +
          acts([['paid', 'ได้รับเงินแล้ว (ตรวจในแอปธนาคาร)', 'go']]);
    } else if (s4 === 'done') {
      b4 = fact('ได้รับเงิน <b>฿' + money(o.total) + '</b>' + (cod ? ' (เงินสด)' : ' (โอน)')) +
        (o.slipUrl ? '<a class="slip-link sm" href="' + esc(o.slipUrl) + '" target="_blank" rel="noopener">' + icon('camera') + ' ดูสลิป</a>' : '');
    } else b4 = fact('ลูกค้าโอนเงินหรือชำระเงินสด หลังยืนยันราคา');
    S.push({ title: cod ? 'ชำระเงินสด (ตอนรับสินค้า)' : 'ชำระเงิน', state: s4 === 'skip' ? 'todo' : s4, at: cod ? o.doneAt : o.paidAt, body: b4 });

    // 5) จัดส่ง / ลูกค้ามารับ
    const s5 = reached(4, o.shippedAt || (st === 'done' ? o.doneAt : ''));
    let b5 = '';
    if (s5 === 'now') {
      if (st === 'confirmed' && cod) {
        b5 = tip(pickup ? 'เตรียมข้าวไว้ให้ลูกค้ามารับ เมื่อลูกค้ารับข้าวและจ่ายเงินสด <b>฿' + money(o.total) + '</b> ครบแล้ว กดปุ่มด้านล่าง'
          : 'นำข้าวไปส่ง และเก็บเงินสด <b>฿' + money(o.total) + '</b> เมื่อส่งและได้เงินครบแล้ว กดปุ่มด้านล่าง') +
          acts([['done', pickup ? 'ลูกค้ามารับสินค้า ชำระเงินเรียบร้อย' : 'ส่งสำเร็จ ได้รับเงินสดแล้ว', 'go']]);
      } else if (st === 'paid') {
        b5 = tip(pickup ? 'เตรียมข้าวให้พร้อม แล้วแจ้งลูกค้าว่ามารับได้' : 'จัดข้าวขึ้นรถ แล้วกด "เริ่มจัดส่ง" ลูกค้าจะได้รับแจ้งทาง LINE') +
          acts([['shipping', pickup ? 'ข้าวพร้อมให้มารับแล้ว' : 'เริ่มจัดส่ง', 'primary'], ['done', pickup ? 'ลูกค้ามารับแล้ว' : 'ส่งสำเร็จแล้ว', 'ghost']]);
      } else if (st === 'shipping') {
        b5 = tip(pickup ? 'รอลูกค้ามารับข้าว' : 'กำลังจัดส่ง — เมื่อลูกค้าได้รับข้าวแล้ว กดปุ่มด้านล่าง') +
          acts([['done', pickup ? 'ลูกค้ามารับแล้ว' : 'ส่งสำเร็จ ลูกค้าได้รับแล้ว', 'go']]);
      }
      b5 += contact;
    } else if (s5 === 'done') b5 = fact(pickup ? 'ลูกค้ามารับสินค้าแล้ว' : 'ส่งถึงลูกค้าแล้ว');
    else b5 = fact(pickup ? 'ลูกค้ามารับที่ร้าน' : 'ส่งถึงที่อยู่ลูกค้า' + (o.distanceKm != null ? ' (~' + o.distanceKm + ' กม.)' : ''));
    S.push({ title: pickup ? 'ลูกค้ามารับสินค้า' : 'จัดส่งสินค้า', state: s5, at: o.shippedAt || (st === 'done' ? o.doneAt : ''), body: b5 });

    // 6) ปิดการขาย
    const s6 = cancelled ? 'cancel' : st === 'done' ? 'done' : 'todo';
    const b6 = st === 'done'
      ? fact('ปิดการขายเรียบร้อย') + (o.zortVoidStatus === 'pending' ? '' : zortLine(o)) +
        '<div class="fs-danger">' + actBtn(['cancelled', 'ยกเลิกการขายนี้ (คืนเงิน / คืนสินค้า)', 'danger', { needNote: true, zortWarn: !!o.zortOrderId }], true) + '</div>'
      : cancelled ? fact('ยกเลิกแล้ว' + (o.cancelReason ? ': ' + esc(o.cancelReason) : '')) + (o.zortVoidStatus === 'pending' ? '' : zortLine(o))
      : fact('ระบบบันทึกยอดขายเข้า ZORT ให้อัตโนมัติเมื่อปิดการขาย');
    S.push({ title: 'ปิดการขาย', state: s6, at: o.doneAt, body: b6 });

    S.forEach((x) => { x.badge = badge(x.state, x.at); });
    return S;
  }

  /** สถานะการบันทึกยอดขายใน ZORT (แสดงเมื่อปิดการขายแล้ว) */
  function zortLine(o) {
    if (o.zortVoidStatus === 'pending') {
      return '<div class="zort-void">' +
        '<div class="zv-h">' + icon('alert') + '<strong>ต้องไปยกเลิกรายการนี้ใน ZORT เอง</strong></div>' +
        '<p>คำสั่งซื้อนี้ถูกยกเลิกหลังจากบันทึกยอดขายใน ZORT แล้ว ระบบยกเลิกใน ZORT ให้อัตโนมัติไม่ได้ ยอดขายและสต็อกใน ZORT จึงยังไม่ถูกต้อง</p>' +
        '<ol><li>เข้า ZORT → รายการขาย → ค้นหาเลขที่ <b>' + esc(o.orderId) + '</b>' + (/^\d+$/.test(o.zortOrderId) ? ' (รหัส ZORT ' + esc(o.zortOrderId) + ')' : '') + '</li>' +
        '<li>กด "ยกเลิก (Void)" รายการนั้น และคืนสต็อกถ้าข้าวกลับมาที่ร้าน</li>' +
        '<li>กลับมากดปุ่มด้านล่างเพื่อปิดงานนี้</li></ol>' +
        '<button type="button" class="btn btn-primary btn-sm" data-act="zort-void-done">' + icon('check') + ' ยกเลิกใน ZORT แล้ว</button></div>';
    }
    if (o.zortVoidStatus === 'done') {
      return '<p class="zort-line ok">' + icon('check') + '<span>ยกเลิกใน ZORT แล้ว' + (o.zortVoidBy ? ' โดย ' + esc(o.zortVoidBy) : '') +
        (o.zortVoidAt ? ' · ' + esc(R.dateTH(o.zortVoidAt, true)) : '') + '</span></p>';
    }
    if (o.status !== 'done' || R.DEMO) return '';
    if (o.zortOrderId) {
      return '<p class="zort-line ok">' + icon('check') + '<span>บันทึกยอดขายใน ZORT แล้ว' +
        (/^\d+$/.test(o.zortOrderId) ? ' (รหัส ZORT ' + esc(o.zortOrderId) + ')' : '') +
        (o.zortSyncedAt ? ' · ' + esc(R.dateTH(o.zortSyncedAt, true)) : '') + '</span></p>';
    }
    if (!A.zort || !A.zort.configured) return '';
    return '<div class="zort-line ' + (o.zortError ? 'err' : 'wait') + '">' + icon(o.zortError ? 'alert' : 'clock') +
      '<span>' + (o.zortError ? 'บันทึกยอดขายเข้า ZORT ไม่สำเร็จ: ' + esc(o.zortError) : 'ยังไม่ได้บันทึกยอดขายใน ZORT') + '</span>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="zort-push">' + icon('refresh') + ' ส่งเข้า ZORT' + (o.zortError ? 'อีกครั้ง' : '') + '</button></div>';
  }

  async function zortVoidDone() {
    const o = A.orders.find((x) => x.orderId === A.sel);
    if (!o) return;
    const ok = await R.confirmBox('ยกเลิกใน ZORT แล้ว?', 'ยืนยันว่าได้ยกเลิก (Void) คำสั่งซื้อ #' + o.orderId + ' ในหน้า ZORT เรียบร้อยแล้ว', 'ยืนยัน ยกเลิกแล้ว', 'ยังไม่ได้ยกเลิก');
    if (!ok) return;
    R.busy(true, 'กำลังบันทึก...');
    try {
      const res = await R.api('adminZortVoidDone', { orderId: o.orderId });
      replaceOrder(res.order);
      render();
      R.toast('ปิดงานยกเลิกใน ZORT แล้ว', 'ok');
    } catch (e) { R.toast(e.message, 'err'); } finally { R.busy(false); }
  }

  async function zortPushOrder() {
    const o = A.orders.find((x) => x.orderId === A.sel);
    if (!o) return;
    R.busy(true, 'กำลังบันทึกยอดขายเข้า ZORT...');
    try {
      const res = await R.api('adminZortPushOrder', { orderId: o.orderId });
      replaceOrder(res.order);
      renderListOnly(); renderDetail();
      if (res.zort && res.zort.ok) R.toast('บันทึกยอดขายใน ZORT แล้ว', 'ok');
      else R.toast('ส่งเข้า ZORT ไม่สำเร็จ: ' + ((res.zort && res.zort.error) || ''), 'err');
    } catch (e) { R.toast(e.message, 'err'); } finally { R.busy(false); }
  }

  /* =========================================================
   * Actions
   * ========================================================= */

  function replaceOrder(o) {
    const old = A.orders.find((x) => x.orderId === o.orderId);
    if (old && old.customer && !o.customer) o.customer = old.customer;
    const i = A.orders.findIndex((x) => x.orderId === o.orderId);
    if (i >= 0) A.orders[i] = o; else A.orders.unshift(o);
    delete drafts[o.orderId];
  }

  function pushToast(res, okText) {
    if (res.pushed) R.toast(okText + ' และส่ง LINE ถึงลูกค้าแล้ว', 'ok');
    else if (res.pushError) R.toast(okText + ' (ส่ง LINE ไม่สำเร็จ: ' + res.pushError + ')', R.DEMO ? 'info' : 'err');
    else R.toast(okText, 'ok');
  }

  async function sendQuote() {
    const o = A.orders.find((x) => x.orderId === A.sel);
    const d = getDraft(o);
    const t = draftTotal(d);
    if (t.total <= 0) { R.toast('ยอดรวมต้องมากกว่า 0 บาท', 'err'); return; }
    if (d.lines.some((l) => Number(l.qty) > 0 && !(Number(l.unitPrice) > 0))) {
      if (!(await R.confirmBox('มีรายการที่ราคาเป็น 0', 'ต้องการส่งราคาต่อไหม', 'ส่งต่อ', 'กลับไปแก้'))) return;
    }
    const ok = await R.confirmBox('ส่งราคาให้ ' + (o.fullName || o.lineName) + '?', 'ยอดรวม ฿' + money(t.total) + ' ลูกค้าจะได้ข้อความใน LINE พร้อมปุ่มยืนยัน', 'ส่งราคา', 'ยกเลิก', 'go');
    if (!ok) return;
    R.busy(true, 'กำลังส่งราคา...');
    try {
      const res = await R.api('adminQuote', { orderId: o.orderId, lines: d.lines, shippingFee: d.shippingFee, discount: d.discount, note: d.note });
      replaceOrder(res.order);
      delete A.editQuote[o.orderId]; delete drafts[o.orderId];
      renderListOnly(); renderDetail();
      pushToast(res, 'บันทึกราคาแล้ว');
    } catch (e) { R.toast(e.message, 'err'); } finally { R.busy(false); }
  }

  async function setStatus(btn) {
    const o = A.orders.find((x) => x.orderId === A.sel);
    const to = btn.dataset.to, label = btn.dataset.label;
    const needNote = !!btn.dataset.neednote, askPay = !!btn.dataset.pay, zortWarn = !!btn.dataset.zortwarn;
    let note = '', notify = true, payMethod = '';
    const ok = await R.modal({
      title: label + '?',
      html: '<p>คำสั่งซื้อ #' + esc(o.orderId) + ' ของ ' + esc(o.fullName || o.lineName) + '</p>' +
        (zortWarn ? '<p class="zort-warn">' + icon('alert') + '<span>รายการนี้บันทึกยอดขายใน ZORT แล้ว — หลังยกเลิก ต้องไปยกเลิก (Void) ในหน้า ZORT เอง ระบบจะติดป้าย “รอยกเลิกใน ZORT” ไว้ให้</span></p>' : '') +
        (askPay ? '<label class="field" style="margin-top:.8rem"><span class="field-label">ลูกค้าจะจ่ายเงินแบบไหน</span><select class="select" id="m-pay"><option value="transfer">โอน / สแกนจ่าย</option><option value="cod">เงินสด</option></select></label>' : '') +
        '<label class="field" style="margin-top:.8rem"><span class="field-label">' + (needNote ? 'เหตุผล (ลูกค้าจะเห็นข้อความนี้)' : 'ข้อความถึงลูกค้า (ไม่บังคับ)') + '</span>' +
        '<input class="input" id="m-note" maxlength="300"' + (to === 'confirmed' && o.status === 'slip' ? ' value="ยอดเงินในสลิปไม่ตรง กรุณาตรวจสอบแล้วส่งใหม่"' : '') + '></label>' +
        '<label class="check-row"><input type="checkbox" id="m-notify" checked> แจ้งลูกค้าทาง LINE</label>',
      actions: [{ label: label, value: true, kind: to === 'cancelled' ? 'danger' : 'primary' }, { label: 'ยกเลิก', value: false, kind: 'ghost' }],
      onAction: (v, wrap) => {
        if (!v) return true;
        note = wrap.querySelector('#m-note').value.trim();
        notify = wrap.querySelector('#m-notify').checked;
        if (askPay) payMethod = wrap.querySelector('#m-pay').value;
        if (needNote && !note) { R.toast('กรุณาใส่เหตุผล', 'err'); wrap.querySelector('#m-note').focus(); return false; }
        return true;
      },
    });
    if (!ok) return;
    R.busy(true, 'กำลังบันทึก...');
    try {
      const res = await R.api('adminSetStatus', { orderId: o.orderId, status: to, note, notify, payMethod });
      replaceOrder(res.order);
      renderListOnly(); renderDetail();
      pushToast(res, 'บันทึกแล้ว');
      if (res.needZortVoid || (res.order && res.order.zortVoidStatus === 'pending' && to === 'cancelled')) { A.filter = 'zortvoid'; syncUrl(); render(); R.toast('อย่าลืมไปยกเลิกรายการนี้ในหน้า ZORT', 'err'); }
      if (res.zort && res.zort.ok) R.toast('ปิดการขายแล้ว และบันทึกยอดขายใน ZORT แล้ว', 'ok');
      else if (res.zort && res.zort.error) R.toast('ปิดการขายแล้ว แต่ส่งยอดขายเข้า ZORT ไม่สำเร็จ — กดส่งใหม่ได้ในหน้านี้', 'err');
    } catch (e) { R.toast(e.message, 'err'); } finally { R.busy(false); }
  }

  function exportCsv() {
    const cols = [
      ['orderId', 'เลขที่'], ['createdAt', 'วันที่สั่ง'], ['status', 'สถานะ'], ['fullName', 'ชื่อ'], ['phone', 'โทร'], ['lineName', 'ชื่อ LINE'],
      ['purposeLabel', 'ซื้อไป'], ['purposeNote', 'รายละเอียด'], ['deliveryMethod', 'การรับ'], ['address', 'ที่อยู่'], ['distanceKm', 'ระยะ(กม.)'],
      ['wantDate', 'ต้องการรับ'], ['itemsText', 'รายการ'], ['totalBags', 'จำนวน'], ['totalKg', 'กก.'],
      ['shippingFee', 'ค่าส่ง'], ['discount', 'ส่วนลด'], ['total', 'ยอดรวม'], ['payMethod', 'จ่ายเงิน'], ['note', 'หมายเหตุ'],
    ];
    const cell = (v) => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';
    const rows = visibleOrders().map((o) => cols.map(([k]) => {
      if (k === 'status') return cell((R.ADMIN_STATUS[o.status] || {}).label || o.status);
      if (k === 'purposeLabel') return cell(R.purposeOf(o.purpose).label);
      if (k === 'createdAt') return cell(R.dateTH(o.createdAt, true));
      if (k === 'shippingFee' || k === 'discount') return cell(o.quote ? o.quote[k] : '');
      if (k === 'itemsText') return cell((o.items || []).map((i) => i.name + ' ' + i.sizeKg + 'กก. x' + i.qty).join(', '));
      if (k === 'deliveryMethod') return cell(o.deliveryMethod === 'pickup' ? 'มารับเอง' : 'ส่งถึงที่');
      return cell(o[k]);
    }).join(','));
    const csv = '﻿' + [cols.map((c) => cell(c[1])).join(',')].concat(rows).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'rice-orders-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.22].forEach((t) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880; o.type = 'sine';
        g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.18);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
      });
    } catch (e) { /* ignore */ }
  }

  async function load(first) {
    const data = await R.api('adminBootstrap');
    A.orders = data.orders; A.products = data.products; A.settings = data.settings;
    A.admin = data.admin; A.sheetUrl = data.sheetUrl; A.zort = data.zort || null; A.loadedAt = Date.now();
    const newIds = A.orders.filter((o) => o.status === 'new').map((o) => o.orderId);
    if (knownNew && !first) {
      const fresh = newIds.filter((id) => knownNew.indexOf(id) < 0);
      if (fresh.length) {
        R.toast('มีคำสั่งซื้อใหม่ ' + fresh.length + ' รายการ', 'ok');
        if (sound) beep();
      }
    }
    knownNew = newIds;
    document.title = (newIds.length ? '(' + newIds.length + ') ' : '') + 'หลังร้าน — ' + (A.settings.SHOP_NAME || 'หจก.บุญมีหาดใหญ่');
  }

  function zortTitle() {
    const l = A.zort && A.zort.lastSync;
    return l ? 'ซิงก์ล่าสุด ' + new Date(l.at).toLocaleString('th-TH') + ' — ' + l.fetched + ' รายการ' : 'ยังไม่เคยซิงก์';
  }

  async function zortSync() {
    if (!A.zort) {
      return R.modal({ title: 'ยังดึงสินค้าจาก ZORT ไม่ได้', html: '<p>Apps Script ยังเป็นเวอร์ชันเก่า กรุณาอัปโหลดไฟล์ใน <code>gas/</code> (รวม <code>Zort.gs</code>) แล้ว Deploy เป็น New version</p>', actions: [{ label: 'ตกลง', value: 1, kind: 'primary' }] });
    }
    if (!A.zort.configured) {
      return R.modal({ title: 'ยังไม่ได้ตั้งค่า ZORT', html: '<p>ใส่ <code>ZORT_STORENAME</code>, <code>ZORT_APIKEY</code>, <code>ZORT_APISECRET</code> ใน Apps Script → Project Settings → Script properties</p><p class="muted">ได้ค่าจาก ZORT: Setting → Integration → ZORT Connect → ZORT API → Generate</p>', actions: [{ label: 'ตกลง', value: 1, kind: 'primary' }] });
    }
    R.busy(true, 'กำลังดึงสินค้าจาก ZORT...');
    try {
      const res = await R.api('adminZortSync');
      A.products = res.products; A.zort = res.zort;
      const r = res.result;
      const im = r.images || {};
      const head = 'ดึงข้าวจาก ZORT ' + r.fetched + ' รายการ (ใหม่ ' + r.added + (r.removed ? ', ลบที่ไม่มีหรือปิดใน ZORT ' + r.removed : '') + ')' + (r.inactive ? ' · ข้ามสินค้าที่ปิดใช้งาน ' + r.inactive + ' รายการ' : '');
      const imgLine = r.images ? 'รูป: ใช้รูปเดิม ' + (im.kept || 0) + ' · Drive ' + (im.drive || 0) + ' · ZORT ' + (im.zort || 0) + ' · ค้นจากเว็บ ' + (im.web || 0) + ' · ไม่มีรูป ' + (im.none || 0) : '';
      render();
      if (im.webSearch === false) {
        R.toast(head + ' · ' + imgLine + ' (ปิดการค้นรูปจากเว็บอยู่ — WEB_IMAGE_SEARCH ในแท็บ Settings)', 'ok');
      } else if ((im.log && im.log.length) || im.webError) {
        const rows = (im.log || []).map((x) => '<li style="margin:4px 0">' + (x.ok ? '✅ ' : '❌ ') + '<b>' + esc(x.name) + '</b><br><span class="muted">' + esc(x.note || '') + '</span></li>').join('');
        R.modal({
          title: 'ดึงสินค้าเสร็จ — ผลการค้นรูปตามชื่อสินค้า',
          html: '<p>' + esc(head) + '<br>' + esc(imgLine) + '</p>' +
            (im.webError ? '<p class="err" style="color:#b42318">⚠️ ' + esc(im.webError) + '</p>' : '') +
            (rows ? '<ul style="padding-left:4px;list-style:none;max-height:50vh;overflow:auto">' + rows + '</ul>' : '') +
            (im.waiting ? '<p class="muted">ยังเหลือ ' + im.waiting + ' รายการ กดดึงอีกครั้งเพื่อค้นต่อ</p>' : '') +
            '<p class="muted">รูปที่ได้เก็บในโฟลเดอร์ "รูปจากเว็บ (อัตโนมัติ)" — รูปไหนไม่ถูก ลบไฟล์ทิ้งแล้วกดดึงอีกครั้ง หรือวางรูปของร้านในโฟลเดอร์รูปสินค้า (ตั้งชื่อไฟล์ตาม SKU หรือชื่อสินค้า) ระบบใช้รูปนั้นก่อนเสมอ</p>',
          actions: [{ label: 'ตกลง', value: 1, kind: 'primary' }],
        });
      } else {
        R.toast(head + (imgLine ? ' · ' + imgLine : '') + (im.none ? '' : ' · สินค้าทุกตัวมีรูปแล้ว'), 'ok');
      }
    } catch (e) {
      R.busy(false);
      if (String(e.code || '').indexOf('zort') === 0) {
        R.modal({ title: 'ดึงสินค้าจาก ZORT ไม่สำเร็จ', html: '<p style="white-space:pre-line">' + esc(String(e.message).replace(/ \| | → | — /g, '\n')) + '</p>', actions: [{ label: 'ตกลง', value: 1, kind: 'primary' }] });
      } else R.toast(e.message, 'err');
    } finally { R.busy(false); }
  }

  async function refresh(manual) {
    try {
      const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest('#quote-card, .modal');
      await load(false);
      if (typing && !manual) { renderListOnly(); return; }
      renderListOnly(); renderDetail();
      if (manual) R.toast('อัปเดตแล้ว', 'ok');
    } catch (e) { if (manual) R.toast(e.message, 'err'); }
  }

  /* ---------- events ---------- */

  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    switch (el.dataset.act) {
      case 'filter':
        if (A.view !== 'orders') { go('orders', el.dataset.id); break; }
        A.filter = el.dataset.id; root.classList.remove('nav-open'); syncUrl(); renderListOnly();
        break;
      case 'view': go(el.dataset.id); break;
      case 'nav-open': root.classList.add('nav-open'); break;
      case 'nav-close': root.classList.remove('nav-open'); break;
      case 'open': {
        const o = A.orders.find((x) => x.orderId === el.dataset.id);
        A.sel = el.dataset.id;
        if (A.view !== 'orders') {
          if (o && !filterOf(A.filter).test(o)) A.filter = FILTERS[0].test(o) ? 'todo' : 'all';
          go('orders');
        } else { renderDetail(); syncUrl(); }
        if (window.innerWidth <= 900) window.scrollTo(0, 0);
        break;
      }
      case 'close': A.sel = ''; renderDetail(); syncUrl(); break;
      case 'refresh': refresh(true); break;
      case 'sound':
        sound = !sound; R.storage(SOUND_KEY, sound);
        document.querySelectorAll('[data-act="sound"]').forEach((b) => b.setAttribute('aria-pressed', String(sound)));
        if (sound) beep();
        R.toast(sound ? 'เปิดเสียงเตือนคำสั่งซื้อใหม่' : 'ปิดเสียงเตือน');
        break;
      case 'csv': exportCsv(); break;
      case 'zort': zortSync(); break;
      case 'zort-push': zortPushOrder(); break;
      case 'zort-void-done': zortVoidDone(); break;
      case 'send-quote': sendQuote(); break;
      case 'edit-quote': A.editQuote[A.sel] = true; renderDetail(); { const qc = document.getElementById('quote-card'); if (qc) qc.scrollIntoView({ behavior: 'smooth', block: 'start' }); } break;
      case 'edit-quote-cancel': delete A.editQuote[A.sel]; delete drafts[A.sel]; renderDetail(); break;
      case 'to-quote': {
        const qc = document.getElementById('quote-card');
        if (qc) { qc.scrollIntoView({ behavior: 'smooth', block: 'start' }); const f = qc.querySelector('input'); if (f) setTimeout(() => f.focus({ preventScroll: true }), 400); }
        break;
      }
      case 'use-ship': {
        const o = A.orders.find((x) => x.orderId === A.sel);
        getDraft(o).shippingFee = Number(el.dataset.v);
        renderDetail();
        break;
      }
      case 'status': setStatus(el); break;
    }
  });

  root.addEventListener('input', (e) => {
    if (e.target.id === 'q') { A.q = e.target.value; document.getElementById('olist').innerHTML = list(); return; }
    if (e.target.id === 'pq') { A.pq = e.target.value; document.getElementById('prows').innerHTML = productRows(); return; }
    const k = e.target.dataset.q;
    if (!k) return;
    const o = A.orders.find((x) => x.orderId === A.sel);
    const d = getDraft(o);
    if (k === 'qty' || k === 'unitPrice') {
      const i = Number(e.target.dataset.i);
      d.lines[i][k] = e.target.value;
      const l = d.lines[i];
      document.getElementById('amt-' + i).textContent = '฿' + money((Number(l.qty) || 0) * (Number(l.unitPrice) || 0));
    } else d[k] = e.target.value;
    const t = draftTotal(d);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('q-sub', '฿' + money(t.sub));
    set('q-ship', Number(d.shippingFee) ? '฿' + money(d.shippingFee) : 'ฟรี');
    set('q-disc', Number(d.discount) ? '−฿' + money(d.discount) : '-');
    set('q-total', '฿' + money(t.total));
  });

  /* ---------- เริ่มต้น / สิทธิ์แอดมิน ---------- */

  function gate(err) {
    let uid = '';
    try { uid = window.liff.getDecodedIDToken().sub; } catch (e) { /* ignore */ }
    root.innerHTML = '<div class="gate"><h1>ยังไม่มีสิทธิ์แอดมิน</h1>' +
      '<p class="muted">' + esc(err.message) + '</p>' +
      (uid ? '<p style="margin-top:.8rem">LINE userId ของคุณ</p><code>' + esc(uid) + '</code>' : '') +
      '<label class="field"><span class="field-label">รหัสลงทะเบียนแอดมิน</span><input class="input" id="claim" inputmode="numeric" autocomplete="one-time-code">' +
      '<span class="field-hint">ดูรหัสได้ที่ Apps Script → Project Settings → Script properties → ADMIN_SETUP_CODE</span></label>' +
      '<button type="button" class="btn btn-primary btn-block" id="claim-btn">ลงทะเบียนเป็นแอดมิน</button></div>';
    document.getElementById('claim-btn').onclick = async () => {
      R.busy(true, 'กำลังตรวจสอบ...');
      try {
        await R.api('adminClaim', { code: document.getElementById('claim').value });
        location.reload();
      } catch (e) { R.toast(e.message, 'err'); } finally { R.busy(false); }
    };
  }

  async function boot() {
    R.injectIcons();
    root.innerHTML = '<div class="splash" style="min-height:100vh;display:grid;place-items:center;text-align:center"><div>' + R.sackLoader('6.5rem') + '<p class="loading-text" style="font-weight:700;margin-top:.6rem">กำลังโหลด...</p></div></div>';
    try {
      await R.initAuth(R.CFG.ADMIN_LIFF_ID || R.CFG.LIFF_ID);
      await load(true);
    } catch (e) {
      if (e.code === 'not_admin') return gate(e);
      root.innerHTML = '<div class="gate"><h1>โหลดไม่สำเร็จ</h1><p>' + esc(e.message) + '</p><button type="button" class="btn btn-primary btn-block" style="margin-top:1rem" onclick="location.reload()">ลองใหม่</button></div>';
      return;
    }
    const [hv, hf] = location.hash.replace(/^#\/?/, '').split('/');
    if (VIEWS[hv]) A.view = hv;
    if (hf && FILTERS.some((f) => f.id === hf)) A.filter = hf;
    const q = new URLSearchParams(location.search).get('order');
    if (q && A.orders.some((o) => o.orderId === q)) { A.sel = q; A.view = 'orders'; A.filter = 'all'; }
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') root.classList.remove('nav-open'); });
    render();
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) refresh(false); }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(false); });
  }

  boot();
})();
