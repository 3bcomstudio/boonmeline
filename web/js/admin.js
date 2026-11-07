/* admin.js — หน้าแอดมิน: ดูคำสั่งซื้อ คิดราคา ส่งราคาเข้า LINE ลูกค้า ตรวจสลิป อัปเดตสถานะ */
(function () {
  'use strict';
  const R = window.Rice;
  const { esc, icon, money } = R;

  const A = { orders: [], products: [], settings: {}, admin: null, sheetUrl: '', zort: null, filter: 'todo', q: '', sel: '', loadedAt: 0 };
  const root = document.getElementById('admin');
  const SOUND_KEY = 'rice_admin_sound';
  let sound = R.storage(SOUND_KEY) === true;
  let knownNew = null;
  let timer = null;
  const drafts = {}; // ฟอร์มคิดราคาที่ยังไม่ส่ง ต่อคำสั่งซื้อ

  const isCodWaiting = (o) => o.status === 'confirmed' && o.payMethod === 'cod';
  const FILTERS = [
    { id: 'todo', label: 'ต้องทำ', test: (o) => o.status === 'new' || o.status === 'slip' || o.status === 'paid' || isCodWaiting(o), hot: true },
    { id: 'new', label: 'รอแจ้งราคา', test: (o) => o.status === 'new' },
    { id: 'quoted', label: 'รอลูกค้ายืนยัน', test: (o) => o.status === 'quoted' },
    { id: 'pay', label: 'รอชำระ / ตรวจสลิป', test: (o) => o.status === 'slip' || (o.status === 'confirmed' && o.payMethod !== 'cod') },
    { id: 'ship', label: 'รอส่ง / กำลังส่ง', test: (o) => o.status === 'paid' || o.status === 'shipping' || isCodWaiting(o) },
    { id: 'done', label: 'สำเร็จ', test: (o) => o.status === 'done' },
    { id: 'cancelled', label: 'ยกเลิก', test: (o) => o.status === 'cancelled' },
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
   * Render
   * ========================================================= */

  function render() {
    root.innerHTML =
      (R.DEMO ? '<div class="demo-banner"><span>โหมดทดลอง: ปุ่มส่ง LINE จะไม่ส่งจริง</span><span><a href="index.html">เปิดหน้าลูกค้า</a></span></div>' : '') +
      '<header class="adm-top"><div class="adm-brand"><img src="assets/logo-96.png" alt="">' + esc(A.settings.SHOP_NAME || 'หจก.บุญมีหาดใหญ่') + ' <small>หลังร้าน</small></div>' +
      '<span class="updated" id="updated"></span>' +
      '<div class="adm-tools">' +
      '<button type="button" class="tbtn" data-act="refresh">' + icon('refresh') + 'รีเฟรช</button>' +
      '<button type="button" class="tbtn" data-act="sound" aria-pressed="' + sound + '">' + icon('bell') + 'เสียงเตือน</button>' +
      '<button type="button" class="tbtn" data-act="csv">' + icon('download') + 'ดาวน์โหลด CSV</button>' +
      (!R.DEMO ? '<button type="button" class="tbtn" data-act="zort" title="' + esc(zortTitle()) + '">' + icon('refresh') + 'ดึงสินค้าจาก ZORT</button>' : '') +
      (A.sheetUrl ? '<a class="tbtn" href="' + esc(A.sheetUrl) + '" target="_blank" rel="noopener">' + icon('sheet') + 'Google Sheet</a>' : '') +
      '</div></header>' +
      '<section class="kpis" id="kpis">' + kpis() + '</section>' +
      '<div class="adm-main"><aside class="list-pane" aria-label="รายการคำสั่งซื้อ">' +
      '<div class="filters" id="filters">' + filters() + '</div>' +
      '<div class="search">' + icon('search') + '<input type="search" id="q" placeholder="ค้นหา เลขที่ ชื่อ เบอร์โทร" value="' + esc(A.q) + '" aria-label="ค้นหาคำสั่งซื้อ"></div>' +
      '<div class="o-list" id="olist">' + list() + '</div></aside>' +
      '<section class="detail-pane" id="detail">' + detail() + '</section></div>';
    root.classList.toggle('show-detail', !!A.sel);
    stamp();
  }

  function renderListOnly() {
    document.getElementById('kpis').innerHTML = kpis();
    document.getElementById('filters').innerHTML = filters();
    document.getElementById('olist').innerHTML = list();
    stamp();
  }
  function renderDetail() {
    document.getElementById('detail').innerHTML = detail();
    root.classList.toggle('show-detail', !!A.sel);
    document.querySelectorAll('.o-row').forEach((r) => r.classList.toggle('active', r.dataset.id === A.sel));
  }
  function stamp() {
    const el = document.getElementById('updated');
    if (el && A.loadedAt) el.textContent = 'อัปเดต ' + R.timeTH(new Date(A.loadedAt).toISOString());
  }

  function kpis() {
    const now = new Date();
    const month = A.orders.filter((o) => { const d = new Date(o.createdAt); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
    const sold = month.filter((o) => ['paid', 'shipping', 'done'].indexOf(o.status) >= 0);
    const sales = sold.reduce((s, o) => s + (o.total || 0), 0);
    const bags = sold.reduce((s, o) => s + (o.totalBags || 0), 0);
    const c = (st) => A.orders.filter((o) => o.status === st).length;
    const ship = A.orders.filter((o) => o.status === 'paid' || isCodWaiting(o)).length;
    const mix = {}; month.filter((o) => o.status !== 'cancelled').forEach((o) => { mix[o.purpose] = (mix[o.purpose] || 0) + 1; });
    const totalMix = Object.values(mix).reduce((a, b) => a + b, 0);
    const k = (n, label, cls, f) => '<button type="button" class="kpi' + (cls ? ' ' + cls : '') + '" data-act="filter" data-id="' + f + '"><b>' + n + '</b><span>' + label + '</span></button>';
    return k(c('new'), 'รอแจ้งราคา', c('new') ? 'hot' : '', 'new') +
      k(c('slip'), 'รอตรวจสลิป', c('slip') ? 'hot' : '', 'pay') +
      k(ship, 'ต้องจัดส่ง', ship ? 'hot' : '', 'ship') +
      '<div class="kpi money"><b>฿' + money(sales) + '</b><span>ยอดขายเดือนนี้ (' + bags + ' ถุง)</span></div>' +
      '<div class="kpi mix"><span>ลูกค้าซื้อไปทำอะไร (เดือนนี้ ' + totalMix + ' รายการ)</span>' +
      '<div class="mix-bar">' + R.PURPOSES.map((p) => mix[p.id] ? '<i class="mx-' + p.id + '" style="width:' + (mix[p.id] / totalMix * 100) + '%" title="' + p.label + ' ' + mix[p.id] + '"></i>' : '').join('') + '</div>' +
      '<div class="mix-legend">' + R.PURPOSES.map((p) => '<span><i class="mx-' + p.id + '"></i>' + p.label + ' ' + (mix[p.id] || 0) + '</span>').join('') + '</div></div>';
  }

  function filters() {
    return FILTERS.map((f) => {
      const n = A.orders.filter(f.test).length;
      return '<button type="button" class="fchip' + (f.hot && n ? ' hot' : '') + '" data-act="filter" data-id="' + f.id + '" aria-pressed="' + (A.filter === f.id) + '">' + f.label + ' <b>' + n + '</b></button>';
    }).join('');
  }

  function visibleOrders() {
    const f = FILTERS.find((x) => x.id === A.filter) || FILTERS[0];
    const q = A.q.trim().toLowerCase();
    return A.orders.filter(f.test).filter((o) => !q ||
      [o.orderId, o.fullName, o.lineName, o.phone, o.purposeNote, o.address].join(' ').toLowerCase().indexOf(q) >= 0 ||
      String(o.phone || '').indexOf(q.replace(/\D/g, '') || '¤') >= 0);
  }

  function list() {
    const rows = visibleOrders();
    if (!rows.length) return '<div class="o-empty">' + (A.filter === 'todo' ? 'ไม่มีงานค้าง เยี่ยมมาก' : 'ไม่มีคำสั่งซื้อในกลุ่มนี้') + '</div>';
    return rows.map((o) =>
      '<button type="button" class="o-row' + (o.orderId === A.sel ? ' active' : '') + (o.status === 'new' ? ' is-new' : '') + '" data-act="open" data-id="' + esc(o.orderId) + '">' +
      '<div class="o-row-top"><b>#' + esc(o.orderId) + '</b>' + statusPill(o) + '</div>' +
      '<div class="o-row-name">' + esc(o.fullName || o.lineName) + '</div>' +
      '<div class="o-row-meta"><span>' + ptag(o) + ' ' + o.totalBags + ' ถุง / ' + o.totalKg + ' กก.</span><span>' + (o.total ? '฿' + money(o.total) : R.ago(o.createdAt)) + '</span></div>' +
      '</button>').join('');
  }

  /* ---------- รายละเอียดคำสั่งซื้อ ---------- */

  function detail() {
    const o = A.orders.find((x) => x.orderId === A.sel);
    if (!o) return '<div class="d-empty"><div>' + icon('receipt') + '<p>เลือกคำสั่งซื้อทางซ้ายเพื่อดูรายละเอียด</p></div></div>';
    const c = o.customer || {};
    const p = R.purposeOf(o.purpose);
    const map = R.mapUrl(o.lat, o.lng);
    const tel = 'tel:' + String(o.phone || '').replace(/\D/g, '');
    const initial = esc(String(o.fullName || o.lineName || '?').trim().charAt(0));

    const itemsRows = (o.items || []).map((i) =>
      '<tr><td><strong>' + esc(i.name) + '</strong><br><span class="muted">' + esc(i.detail || '') + ' ' + i.sizeKg + ' กก./' + esc(i.unit) + '</span></td>' +
      '<td class="num">' + i.qty + ' ' + esc(i.unit) + '</td><td class="num">' + (i.qty * i.sizeKg) + ' กก.</td></tr>').join('');

    return '<div class="d-head">' +
      '<button type="button" class="btn btn-ghost btn-sm d-back" data-act="close">' + icon('back') + ' รายการ</button>' +
      '<h2>#' + esc(o.orderId) + '</h2>' + statusPill(o) +
      '<span class="muted">สั่งเมื่อ ' + R.dateTH(o.createdAt, true) + ' (' + R.ago(o.createdAt) + ')</span></div>' +
      '<div class="d-grid">' +

      '<section class="card"><h3>ลูกค้า</h3>' +
      '<div class="cust"><span class="avatar">' + (c.linePicture ? '<img src="' + esc(c.linePicture) + '" alt="">' : initial) + '</span>' +
      '<div><strong>' + esc(o.fullName || '-') + '</strong><span class="muted">LINE: ' + esc(o.lineName || '-') + (c.orderCount > 1 ? ' (สั่งครั้งที่ ' + c.orderCount + ')' : ' (ลูกค้าใหม่)') + '</span></div></div>' +
      '<dl class="kv">' +
      '<dt>โทร</dt><dd><a href="' + tel + '">' + esc(R.phoneFmt(o.phone)) + '</a></dd>' +
      '<dt>ซื้อไป</dt><dd><span class="purpose-hl">' + icon(p.icon) + esc(p.label) + '</span>' + (o.purposeNote ? '<br>' + esc(o.purposeNote) : '') + '</dd>' +
      '<dt>รับข้าว</dt><dd>' + (o.deliveryMethod === 'pickup' ? 'มารับเองที่ร้าน' : 'ส่งถึงที่' + (o.address ? '<br>' + esc(o.address) : '')) + '</dd>' +
      (o.deliveryMethod === 'delivery' && o.distanceKm != null ? '<dt>ระยะทาง</dt><dd>~' + o.distanceKm + ' กม. จากร้าน (เส้นตรง)</dd>' : '') +
      (o.wantDate ? '<dt>ต้องการรับ</dt><dd>' + esc(o.wantDate) + '</dd>' : '') +
      (o.note ? '<dt>หมายเหตุ</dt><dd>' + esc(o.note) + '</dd>' : '') +
      (o.payMethod ? '<dt>จ่ายเงิน</dt><dd>' + (o.payMethod === 'cod' ? 'เงินสด (ปลายทาง/ที่ร้าน)' : 'โอน / สแกนจ่าย') + '</dd>' : '') +
      '</dl><div class="links">' +
      '<a class="btn btn-ghost btn-sm" href="' + tel + '">' + icon('phone') + ' โทร</a>' +
      (map ? '<a class="btn btn-ghost btn-sm" href="' + map + '" target="_blank" rel="noopener">' + icon('map') + ' แผนที่</a>' : '') +
      '</div></section>' +

      '<section class="card"><h3>รายการที่สั่ง</h3><table class="items-t"><thead><tr><th>ข้าว</th><th class="num">จำนวน</th><th class="num">น้ำหนัก</th></tr></thead>' +
      '<tbody>' + itemsRows + '</tbody><tfoot><tr><td>รวม</td><td class="num">' + o.totalBags + ' หน่วย</td><td class="num">' + o.totalKg + ' กก.</td></tr></tfoot></table></section>' +

      quoteCard(o) + actionCard(o) +

      '<section class="card span2"><h3>ประวัติ</h3><ul class="hist">' +
      (o.history || []).slice().reverse().map((h) =>
        '<li><time>' + R.dateTH(h.at, true) + '</time><span><strong>' + esc((R.ADMIN_STATUS[h.status] || {}).label || h.status) + '</strong>' +
        ' โดย ' + esc(String(h.by || '').replace(/^admin:/, 'แอดมิน ').replace('customer', 'ลูกค้า')) + (h.note ? ' — ' + esc(h.note) : '') + '</span></li>').join('') +
      '</ul></section></div>';
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
    if (!editable) {
      if (!o.quote) return '';
      const q = o.quote;
      return '<section class="card span2"><h3>ราคาที่แจ้งลูกค้า</h3><table class="q-table"><thead><tr><th>รายการ</th><th class="num">จำนวน</th><th class="num">ราคา/หน่วย</th><th class="num">รวม</th></tr></thead><tbody>' +
        q.lines.map((l) => '<tr><td>' + esc(l.name) + (l.sizeKg ? ' ' + l.sizeKg + ' กก.' : '') + '</td><td class="num">' + l.qty + ' ' + esc(l.unit) + '</td><td class="num">฿' + money(l.unitPrice) + '</td><td class="num">฿' + money(l.amount) + '</td></tr>').join('') +
        '</tbody></table><dl class="kv" style="margin-top:.6rem"><dt>ค่าส่ง</dt><dd>฿' + money(q.shippingFee) + '</dd><dt>ส่วนลด</dt><dd>฿' + money(q.discount) + '</dd>' + (q.note ? '<dt>ข้อความ</dt><dd>' + esc(q.note) + '</dd>' : '') + '</dl>' +
        '<div class="q-total"><span>ยอดรวม</span><b>฿' + money(q.total) + '</b></div></section>';
    }
    const d = getDraft(o);
    const t = draftTotal(d);
    const sug = suggestShip(o);
    const wholesale = o.purpose === 'restaurant' || o.purpose === 'wholesale';
    const title = o.status === 'new' ? 'คิดราคาแล้วส่งให้ลูกค้า' : 'แก้ราคา แล้วส่งใหม่';
    return '<section class="card span2" id="quote-card"><h3>' + title + '</h3>' +
      '<p class="tier">ราคาตั้งต้นจากแท็บ Products: ' + (wholesale ? 'ราคาส่ง (ลูกค้า' + esc(R.purposeOf(o.purpose).label) + ')' : 'ราคาปลีก') + ' แก้ได้ทุกช่อง</p>' +
      '<table class="q-table"><thead><tr><th>รายการ</th><th class="num">จำนวน</th><th class="num">ราคา/หน่วย</th><th class="num">รวม</th></tr></thead><tbody>' +
      d.lines.map((l, i) =>
        '<tr><td><strong>' + esc(l.name) + '</strong>' + (l.sizeKg ? '<br><span class="muted">' + l.sizeKg + ' กก./' + esc(l.unit) + '</span>' : '') + '</td>' +
        '<td class="qcol"><input type="number" min="0" inputmode="numeric" data-q="qty" data-i="' + i + '" value="' + l.qty + '" aria-label="จำนวน ' + esc(l.name) + '"></td>' +
        '<td class="pcol"><input type="number" min="0" step="0.01" inputmode="decimal" data-q="unitPrice" data-i="' + i + '" value="' + l.unitPrice + '" aria-label="ราคาต่อหน่วย ' + esc(l.name) + '"></td>' +
        '<td class="num" id="amt-' + i + '">฿' + money((Number(l.qty) || 0) * (Number(l.unitPrice) || 0)) + '</td></tr>').join('') +
      '</tbody></table>' +
      '<div class="q-extra">' +
      '<label>ค่าส่ง (บาท)<input type="number" min="0" inputmode="decimal" data-q="shippingFee" value="' + d.shippingFee + '">' +
      (sug ? '<span class="q-hint">แนะนำ ฿' + money(sug.fee) + ' (' + esc(sug.why) + ')' + (Number(d.shippingFee) !== sug.fee ? ' <button type="button" data-act="use-ship" data-v="' + sug.fee + '">ใช้ค่านี้</button>' : '') + '</span>' : '') + '</label>' +
      '<label>ส่วนลด (บาท)<input type="number" min="0" inputmode="decimal" data-q="discount" value="' + d.discount + '"></label>' +
      '<label class="full">ข้อความถึงลูกค้า (ไม่บังคับ)<input type="text" maxlength="300" data-q="note" value="' + esc(d.note) + '" placeholder="เช่น ส่งได้พรุ่งนี้เช้า / ลดให้เพราะทำบุญ"></label>' +
      '</div>' +
      '<div class="q-total"><span>ยอดที่ลูกค้าต้องจ่าย</span><b id="q-total">฿' + money(t.total) + '</b></div>' +
      '<button type="button" class="btn btn-go btn-lg btn-block" data-act="send-quote">' + icon('chat') + (o.status === 'new' ? ' ส่งราคาให้ลูกค้าทาง LINE' : ' ส่งราคาใหม่ให้ลูกค้า') + '</button>' +
      '</section>';
  }

  function actionCard(o) {
    const acts = [];
    let note = '';
    const pickup = o.deliveryMethod === 'pickup';
    const shipLabel = pickup ? 'ข้าวพร้อมให้มารับ' : 'เริ่มจัดส่ง';
    switch (o.status) {
      case 'new':
        note = 'กรอกราคาด้านบน แล้วกดส่ง ลูกค้าจะได้ข้อความใน LINE พร้อมปุ่มยืนยัน';
        break;
      case 'quoted':
        note = 'ส่งราคาแล้ว ' + R.ago(o.quotedAt) + ' รอลูกค้ากดยืนยัน ถ้าลูกค้ายืนยันทางโทรศัพท์ กดปุ่มด้านล่างแทนได้';
        acts.push(['confirmed', 'ลูกค้ายืนยันทางโทรศัพท์', 'ghost', { pay: true }]);
        break;
      case 'confirmed':
        if (o.payMethod === 'cod') {
          note = 'ลูกค้าเลือกจ่ายเงินสด ฿' + money(o.total) + (pickup ? ' ตอนมารับ' : ' ตอนรับข้าว');
          acts.push(['shipping', shipLabel, 'primary']);
          acts.push(['done', pickup ? 'ลูกค้ารับข้าวและจ่ายเงินแล้ว' : 'ส่งสำเร็จ เก็บเงินแล้ว', 'go']);
        } else {
          note = 'ลูกค้ายืนยันแล้ว รอโอนเงิน ฿' + money(o.total) + ' และส่งสลิป';
          acts.push(['paid', 'ได้รับเงินแล้ว (ตรวจในแอปธนาคาร)', 'go']);
        }
        break;
      case 'slip':
        note = 'ตรวจยอด ฿' + money(o.total) + ' ในแอปธนาคารให้ตรงกับสลิป';
        acts.push(['paid', 'สลิปถูกต้อง ได้รับเงินแล้ว', 'go']);
        acts.push(['confirmed', 'สลิปไม่ถูกต้อง ขอให้ส่งใหม่', 'danger', { needNote: true }]);
        break;
      case 'paid':
        acts.push(['shipping', shipLabel, 'primary']);
        acts.push(['done', pickup ? 'ลูกค้ามารับแล้ว' : 'ส่งสำเร็จ', 'ghost']);
        break;
      case 'shipping':
        acts.push(['done', pickup ? 'ลูกค้ามารับแล้ว' : 'ส่งสำเร็จ ลูกค้าได้รับแล้ว', 'go']);
        break;
      case 'done':
        note = 'คำสั่งซื้อเสร็จสมบูรณ์ ' + R.dateTH(o.doneAt, true);
        break;
      case 'cancelled':
        note = 'ยกเลิกแล้ว: ' + (o.cancelReason || '-');
        break;
    }
    if (['done', 'cancelled'].indexOf(o.status) < 0) acts.push(['cancelled', 'ยกเลิกคำสั่งซื้อ', 'danger', { needNote: true }]);
    const slip = o.slipUrl
      ? '<a class="slip-link" href="' + esc(o.slipUrl) + '" target="_blank" rel="noopener">' + icon('camera') + ' เปิดดูรูปสลิป' + (o.slipAt ? ' (ส่งเมื่อ ' + R.ago(o.slipAt) + ')' : '') + '</a>'
      : '';
    return '<section class="card span2"><h3>ขั้นตอนถัดไป</h3>' + slip +
      (note ? '<p class="act-note">' + esc(note) + '</p>' : '') +
      '<div class="act-list">' + acts.map((a) =>
        '<button type="button" class="btn btn-' + a[2] + ' btn-block" data-act="status" data-to="' + a[0] + '" data-label="' + esc(a[1]) + '"' +
        (a[3] && a[3].needNote ? ' data-neednote="1"' : '') + (a[3] && a[3].pay ? ' data-pay="1"' : '') + '>' + esc(a[1]) + '</button>').join('') +
      '</div></section>';
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
      renderListOnly(); renderDetail();
      pushToast(res, 'บันทึกราคาแล้ว');
    } catch (e) { R.toast(e.message, 'err'); } finally { R.busy(false); }
  }

  async function setStatus(btn) {
    const o = A.orders.find((x) => x.orderId === A.sel);
    const to = btn.dataset.to, label = btn.dataset.label;
    const needNote = !!btn.dataset.neednote, askPay = !!btn.dataset.pay;
    let note = '', notify = true, payMethod = '';
    const ok = await R.modal({
      title: label + '?',
      html: '<p>คำสั่งซื้อ #' + esc(o.orderId) + ' ของ ' + esc(o.fullName || o.lineName) + '</p>' +
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
      R.toast('ดึงข้าวจาก ZORT ' + r.fetched + ' รายการ (ใหม่ ' + r.added + (r.removed ? ', ลบที่ไม่มีใน ZORT ' + r.removed : '') + ')', 'ok');
      render();
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
      case 'filter': A.filter = el.dataset.id; renderListOnly(); break;
      case 'open':
        A.sel = el.dataset.id; renderDetail();
        history.replaceState(null, '', location.pathname + '?order=' + encodeURIComponent(A.sel));
        if (window.innerWidth <= 900) window.scrollTo(0, 0);
        break;
      case 'close': A.sel = ''; renderDetail(); history.replaceState(null, '', location.pathname); break;
      case 'refresh': refresh(true); break;
      case 'sound':
        sound = !sound; R.storage(SOUND_KEY, sound); el.setAttribute('aria-pressed', String(sound));
        if (sound) beep();
        R.toast(sound ? 'เปิดเสียงเตือนคำสั่งซื้อใหม่' : 'ปิดเสียงเตือน');
        break;
      case 'csv': exportCsv(); break;
      case 'zort': zortSync(); break;
      case 'send-quote': sendQuote(); break;
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
    document.getElementById('q-total').textContent = '฿' + money(draftTotal(d).total);
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
    const q = new URLSearchParams(location.search).get('order');
    if (q && A.orders.some((o) => o.orderId === q)) { A.sel = q; A.filter = 'all'; }
    render();
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) refresh(false); }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(false); });
  }

  boot();
})();
