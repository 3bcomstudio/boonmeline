/* app.js — หน้าลูกค้า (LIFF)
 * หน้าจอ: ลงทะเบียน → หน้าแรก → เลือกข้าว → วัตถุประสงค์ → การรับข้าว → ตรวจสอบ → ส่ง
 *         คำสั่งซื้อของฉัน → ดูราคา/ยืนยัน → จ่ายเงิน (QR พร้อมเพย์ + ส่งสลิป)
 */
(function () {
  'use strict';
  const R = window.Rice;
  const { esc, icon, money } = R;

  const S = { user: null, customer: null, products: [], settings: {}, orders: [], loaded: false, fetchedAt: 0 };
  const app = document.getElementById('app');

  /* ---------- ตะกร้า (จำไว้ในเครื่อง เผื่อปิดหน้าไปกลางคัน) ---------- */
  const CART_KEY = 'rice_cart_v1';
  const newCart = () => ({ items: {}, purpose: '', purposeNote: '', deliveryMethod: '', address: '', lat: null, lng: null, wantMode: 'asap', wantDate: '', note: '' });
  let cart = Object.assign(newCart(), R.storage(CART_KEY) || {});
  const saveCart = () => R.storage(CART_KEY, cart);
  let pf = null;        // ข้อมูลฟอร์มโปรไฟล์ระหว่างแก้ไข
  let payChoice = {};   // วิธีจ่ายเงินที่เลือก ต่อคำสั่งซื้อ

  /* ---------- ขนาดตัวอักษร ---------- */
  const SIZES = [{ id: 'm', label: 'ปกติ', px: 18 }, { id: 'l', label: 'ใหญ่', px: 20 }, { id: 'xl', label: 'ใหญ่มาก', px: 23 }];
  const fontSizeLabel = () => (SIZES.find((x) => x.id === (document.documentElement.dataset.size || 'l')) || SIZES[1]).label;
  const applySize = (id) => { document.documentElement.dataset.size = id; R.storage('rice_size', id); };
  applySize(R.storage('rice_size') || 'l');

  /* ---------- เส้นทางหน้า ---------- */
  let lastKey = '';
  const route = () => {
    const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
    return { name: name || 'home', arg: decodeURIComponent(arg || '') };
  };
  const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };
  window.addEventListener('hashchange', render);

  const shopName = () => S.settings.SHOP_NAME || 'หจก.บุญมีหาดใหญ่';
  /** ลิงก์โทรเบอร์แรกของร้าน (เบอร์หลัก) */
  const telLink = () => 'tel:' + (R.phoneList(S.settings.SHOP_PHONE)[0] || '');
  const mainPhone = () => R.phoneFmt(R.phoneList(S.settings.SHOP_PHONE)[0] || S.settings.SHOP_PHONE);
  /** ทุกเบอร์ของร้าน แต่ละเบอร์กดโทรได้ */
  const phoneLinks = () => R.phoneList(S.settings.SHOP_PHONE).map((d) => '<a href="tel:' + d + '">' + esc(R.phoneFmt(d)) + '</a>').join(', ');
  const productById = (id) => S.products.find((p) => p.id === id);

  function cartLines() {
    return S.products.filter((p) => cart.items[p.id] > 0).map((p) => ({ p, qty: cart.items[p.id] }));
  }
  function cartSummary() {
    const units = {}; let kg = 0;
    cartLines().forEach(({ p, qty }) => { units[p.unit] = (units[p.unit] || 0) + qty; kg += qty * p.sizeKg; });
    return { count: Object.keys(units).length, text: Object.keys(units).map((u) => units[u] + ' ' + u).join(' '), kg };
  }
  function wantText() {
    if (cart.wantMode === 'tomorrow') {
      const n = nextOpenDay();
      return n.label + ' (' + R.dateTH(n.date.toISOString()) + ')';
    }
    if (cart.wantMode === 'date' && cart.wantDate) return R.dateTH(cart.wantDate + 'T12:00:00');
    return 'ตอนนี้';
  }

  /* =========================================================
   * Render
   * ========================================================= */

  function render() {
    if (!S.loaded) return;
    const r = route();
    if (!S.customer && r.name !== 'register') { location.replace('#/register'); return; }
    const guard = stepGuard(r.name);
    if (guard) { location.replace(guard); return; }

    const prevName = lastKey.split('/')[0];
    if (prevName === 'shop' && r.name === 'home') resetShop();
    const view = (VIEWS[r.name] || VIEWS.home)(r.arg);
    if (!view) return;
    app.innerHTML = shell(view);
    const key = r.name + '/' + r.arg;
    if (key !== lastKey) {
      window.scrollTo(0, 0);
      const h = document.querySelector('.page-title, .hello strong');
      const touch = window.matchMedia && window.matchMedia('(hover: none), (pointer: coarse)').matches;
      if (h && lastKey && !touch) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
      lastKey = key;
      maybeRefresh(r);
    }
  }

  function stepGuard(name) {
    const hasItems = cartLines().length > 0;
    if (['purpose', 'delivery', 'review'].indexOf(name) >= 0 && !hasItems) return '#/shop';
    if (['delivery', 'review'].indexOf(name) >= 0 && !cart.purpose) return '#/purpose';
    if (name === 'review' && !cart.deliveryMethod) return '#/delivery';
    return '';
  }

  function shell(v) {
    return (R.DEMO ? demoBanner() : '') +
      '<header class="topbar">' +
      (v.back
        ? '<button type="button" class="tb-back" data-act="' + (v.backAct || 'go') + '" data-to="' + v.back + '" aria-label="กลับไปหน้าก่อน">' + icon('back') + '<span>กลับ</span></button>'
        : '<img class="topbar-logo" src="assets/logo-96.png" alt="">') +
      '<h1 class="topbar-title' + (v.back ? ' is-center' : '') + '">' + esc(v.top || shopName()) + '</h1>' +
      '<button type="button" class="tb-size" data-act="size" aria-haspopup="dialog" aria-label="ขนาดตัวอักษร (ตอนนี้: ' + esc(fontSizeLabel()) + ') แตะเพื่อเปลี่ยน">' +
        '<span class="tb-size-g" aria-hidden="true"><span class="g1">ก</span><span class="g2">ก</span></span>' +
        '<span class="tb-size-t">ตัวอักษร</span></button>' +
      '</header>' +
      '<main class="page' + (v.bar ? ' has-bar' : '') + '" id="main">' + v.body + '</main>' +
      (v.bar ? '<div class="actionbar"><div class="actionbar-in">' + v.bar + '</div></div>' : '');
  }

  /* ---------- ข้อมูลร้าน / ความปลอดภัย (สร้างความมั่นใจว่าเป็นร้านจริง) ---------- */
  const payeeName = () => String(S.settings.PROMPTPAY_NAME || shopName()).trim();

  function safetyNote(compact) {
    const items = [
      'ทางร้านไม่มีนโยบายขอรหัส OTP รหัส ATM หรือรหัสผ่านแอปธนาคารของท่าน',
    ];
    if (S.settings.SHOP_PHONE) items.push('หากมีข้อสงสัยเพิ่มเติม สามารถโทรสอบถามได้ที่ ' + phoneLinks());
    return '<aside class="safety' + (compact ? ' compact' : '') + '" aria-label="ข้อควรรู้เพื่อความปลอดภัย">' +
      '<div class="safety-h">' + icon('alert') + '<strong>ข้อควรรู้เพื่อความปลอดภัย</strong></div>' +
      '<ul>' + items.map((t) => '<li>' + t + '</li>').join('') + '</ul>' +
      '</aside>';
  }

  function demoBanner() {
    return '<div class="demo-banner"><span>โหมดทดลอง: ยังไม่เชื่อม LINE</span>' +
      '<span><a href="admin.html">เปิดหน้าแอดมิน</a>&nbsp;&nbsp;<button type="button" data-act="demo-reset">ล้างข้อมูลทดลอง</button></span></div>';
  }

  function stepHead(n, title, lead) {
    return '<div class="step-head"><div class="step-count">ขั้นที่ ' + n + ' จาก 4</div>' +
      '<div class="progress" aria-hidden="true">' + [1, 2, 3, 4].map((i) => '<span class="' + (i <= n ? 'on' : '') + '"></span>').join('') + '</div>' +
      '<h1 class="page-title">' + title + '</h1>' + (lead ? '<p class="page-lead">' + lead + '</p>' : '') + '</div>';
  }

  function tile(o) {
    return '<button type="button" class="tile' + (o.wide ? ' wide' : '') + '" data-act="' + o.act + '" data-id="' + o.id + '" aria-pressed="' + (o.on ? 'true' : 'false') + '">' +
      '<span class="t-ic">' + icon(o.icon) + '</span><span class="t-text"><strong>' + esc(o.label) + '</strong>' +
      (o.sub ? '<span class="t-sub">' + esc(o.sub) + '</span>' : '') + '</span>' +
      '<span class="t-check">' + icon('check') + '</span></button>';
  }

  /* =========================================================
   * Views
   * ========================================================= */

  const VIEWS = {};

  VIEWS.home = function () {
    const c = S.customer;
    const first = String(c.fullName || S.user.name || '').trim().split(/\s+/)[0];
    const pending = S.orders.filter((o) => R.statusInfo(o).action);
    const active = S.orders.filter((o) => ['done', 'cancelled'].indexOf(o.status) < 0).length;
    const last = S.orders.find((o) => o.status !== 'cancelled' && o.items && o.items.length);

    let alert = '';
    if (pending.length) {
      const o = pending[0];
      const st = R.statusInfo(o);
      alert = '<button type="button" class="alert-card" data-act="go" data-to="#/order/' + esc(o.orderId) + '">' + icon(st.icon) +
        '<strong class="ac-text">' + (pending.length > 1 ? 'มีรายการรอคุณกด ' + pending.length + ' รายการ' : esc(st.label)) + '</strong>' +
        '<span class="ac-sub">' + esc(st.next) + (o.total ? ' (฿' + money(o.total) + ')' : '') + '</span></button>';
    }

    let reorder = '';
    if (last) {
      const i0 = last.items[0];
      const more = last.items.length > 1 ? ' และอีก ' + (last.items.length - 1) + ' รายการ' : '';
      reorder = menuItem({ act: 'reorder', id: last.orderId, icon: 'repeat', label: 'สั่งเหมือนครั้งก่อน', sub: i0.name + ' ' + i0.qty + ' ' + i0.unit + more });
    }

    return {
      body:
        helloCard(first) + alert +
        '<button type="button" class="order-cta" data-act="go" data-to="#/shop">' +
        '<span class="badge-ic">' + icon('cart') + '</span>' +
        '<span class="cta-text"><strong>สั่งซื้อข้าวสาร</strong></span></button>' +
        '<nav class="menu" aria-label="เมนู">' + reorder +
        menuItem({ act: 'go', to: '#/orders', icon: 'receipt', label: 'ประวัติการสั่ง', sub: active ? 'ยังไม่เสร็จ ' + active + ' รายการ' : 'ดูรายการที่เคยสั่งซื้อ และติดตามสถานะการจัดส่ง', badge: pending.length }) +
        '</nav>' +
        safetyNote(),
    };
  };

  /* ---------- การ์ดต้อนรับ: ทักตามช่วงเวลา + สถานะร้านตอนนี้ ---------- */
  function greeting(d) {
    const h = d.getHours();
    if (h < 11) return 'สวัสดีตอนเช้า';
    if (h < 16) return 'สวัสดีตอนบ่าย';
    if (h < 19) return 'สวัสดีตอนเย็น';
    return 'สวัสดี';
  }

  const DAY_TH = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];
  /** อ่านเวลาทำการจากข้อความ เช่น "วันจันทร์–วันเสาร์ 8.00–17.00 น." / "ทุกวัน 08:00–18:00" — อ่านไม่ออกคืน null */
  function parseHours(text) {
    const t = String(text || '');
    const m = t.match(/(\d{1,2})[.:](\d{2})\s*(?:น\.?)?\s*[-–—ถึง]+\s*(\d{1,2})[.:](\d{2})/);
    if (!m) return null;
    const open = +m[1] * 60 + +m[2], close = +m[3] * 60 + +m[4];
    let days = [0, 1, 2, 3, 4, 5, 6];
    if (!/ทุกวัน/.test(t)) {
      const idx = (name) => DAY_TH.findIndex((d) => name.indexOf(d) >= 0 || (d === 'พฤหัส' && /พฤ/.test(name)));
      const range = t.match(/(อาทิตย์|จันทร์|อังคาร|พุธ|พฤหัส\S*|ศุกร์|เสาร์)\s*[-–—ถึง]+\s*(?:วัน)?(อาทิตย์|จันทร์|อังคาร|พุธ|พฤหัส\S*|ศุกร์|เสาร์)/);
      if (range) {
        const a = idx(range[1]), b = idx(range[2]);
        days = [];
        for (let i = a; ; i = (i + 1) % 7) { days.push(i); if (i === b || days.length > 7) break; }
      } else {
        const listed = DAY_TH.map((d, i) => (t.indexOf(d) >= 0 ? i : -1)).filter((i) => i >= 0);
        if (listed.length) days = listed;
      }
    }
    return { open, close, days };
  }
  const hm = (min) => Math.floor(min / 60) + '.' + String(min % 60).padStart(2, '0') + ' น.';

  function shopStatus(now) {
    const hrs = parseHours(S.settings.SHOP_HOURS);
    if (!hrs) return null;
    const mins = now.getHours() * 60 + now.getMinutes();
    const today = now.getDay();
    if (hrs.days.indexOf(today) >= 0 && mins >= hrs.open && mins < hrs.close) {
      return { open: true, text: 'ร้านเปิดอยู่', sub: 'ปิด ' + hm(hrs.close) };
    }
    // หาวันเปิดถัดไป
    for (let k = 0; k < 8; k++) {
      const day = (today + k) % 7;
      if (hrs.days.indexOf(day) < 0) continue;
      if (k === 0 && mins >= hrs.open) continue;
      const when = k === 0 ? 'วันนี้' : k === 1 ? 'พรุ่งนี้' : 'วัน' + DAY_TH[day];
      return { open: false, text: 'ร้านปิดอยู่', sub: 'เปิด' + when + ' ' + hm(hrs.open) + ' · สั่งล่วงหน้าได้เลย' };
    }
    return null;
  }

  /** ตอนนี้ร้านปิดอยู่ไหม (อ่านเวลาทำการไม่ออก = ถือว่าเปิด ไม่บังคับอะไร) */
  function closedNow() {
    const st = shopStatus(new Date());
    return !!(st && !st.open);
  }
  const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  /** วันนั้นร้านเปิดไหม (อ่านเวลาทำการไม่ออก = เปิด) */
  function openOn(d) {
    const hrs = parseHours(S.settings.SHOP_HOURS);
    return !hrs || hrs.days.indexOf(d.getDay()) >= 0;
  }
  /** วันเปิดถัดไปหลังวันนี้ — ปกติคือพรุ่งนี้ ถ้าพรุ่งนี้ร้านหยุดจะเลื่อนไปวันเปิดถัดไป */
  function nextOpenDay() {
    const d = new Date(); d.setHours(12, 0, 0, 0);
    for (let k = 1; k <= 7; k++) {
      d.setDate(d.getDate() + 1);
      if (openOn(d)) return { date: new Date(d), label: k === 1 ? 'พรุ่งนี้' : 'วัน' + DAY_TH[d.getDay()] };
    }
    const t = new Date(); t.setDate(t.getDate() + 1);
    return { date: t, label: 'พรุ่งนี้' };
  }
  /** นอกเวลาทำการเลือก "ตอนนี้" ไม่ได้ → เปลี่ยนเป็นวันเปิดถัดไปให้เอง */
  function normalizeWant() {
    if (cart.wantMode === 'asap' && closedNow()) { cart.wantMode = 'tomorrow'; saveCart(); }
  }

  function helloCard(first) {
    const now = new Date();
    const name = first || 'ลูกค้า';
    const pic = (S.user && S.user.picture) || (S.customer && S.customer.linePicture) || '';
    const st = shopStatus(now);
    const count = Number(S.customer && S.customer.orderCount) || 0;
    return '<section class="hello-card">' +
      '<div class="hc-top">' +
      '<span class="hc-avatar" aria-hidden="true">' + (pic
        ? '<img src="' + esc(pic) + '" alt="" width="64" height="64" referrerpolicy="no-referrer" onerror="this.remove()">'
        : '') + '<span>' + esc(Array.from(name)[0] || '') + '</span></span>' +
      '<div class="hc-text"><small>' + greeting(now) + '</small><strong>คุณ' + esc(name) + '</strong>' +
      (count ? '<span class="hc-meta">' + icon('receipt') + 'สั่งข้าวกับร้านแล้ว ' + count + ' ครั้ง</span>' : '<span class="hc-meta">' + icon('check') + 'ยินดีต้อนรับลูกค้าใหม่</span>') +
      '</div></div>' +
      (st ? '<div class="hc-status ' + (st.open ? 'is-open' : 'is-closed') + '"><span class="dot" aria-hidden="true"></span>' +
        '<strong>' + st.text + '</strong><span>' + esc(st.sub) + '</span></div>' : '') +
      '</section>';
  }

  function menuItem(o) {
    return '<button type="button" class="menu-item" data-act="' + o.act + '"' + (o.to ? ' data-to="' + o.to + '"' : '') + (o.id ? ' data-id="' + esc(o.id) + '"' : '') + '>' +
      '<span class="mi-ic">' + icon(o.icon) + '</span>' +
      '<span class="mi-text"><strong>' + esc(o.label) + '</strong><span class="mi-sub">' + esc(o.sub) + '</span></span>' +
      (o.badge ? '<span class="count-badge" aria-label="รอคุณกด ' + o.badge + ' รายการ">' + o.badge + '</span>' : icon('chevron')) + '</button>';
  }

  /* ---------- ขั้นที่ 1: เลือกข้าว ---------- */

  VIEWS.shop = function () {
    if (!S.products.length) {
      return {
        back: '#/', backAct: 'shop-exit', top: 'สั่งซื้อข้าวสาร',
        body: stepHead(1, 'กรุณาเลือกยี่ห้อข้าวสารที่ต้องการ', '') + '<div class="prod-list"><div class="empty">' + icon('rice') + '<p>ตอนนี้ยังไม่มีข้าวให้เลือก กรุณาโทรหาร้าน</p></div></div>',
        bar: shopBar(),
      };
    }
    return {
      back: '#/', backAct: 'shop-exit', top: 'สั่งซื้อข้าวสาร',
      body: stepHead(1, 'กรุณาเลือกยี่ห้อข้าวสารที่ต้องการ', 'แตะที่ชื่อข้าว แล้วระบุขนาดและจำนวน') + shopFilters() +
        '<div class="prod-list" id="prod-list">' + prodListHtml() + '</div>',
      bar: shopBar(),
    };
  };

  /* ---------- ค้นหา / กรองข้าว: หมวด, หน่วย, น้ำหนัก ---------- */
  const F = { q: '', cat: '', unit: '', size: '' };

  const uniq = (arr) => arr.filter((v, i) => v !== '' && v !== null && v !== undefined && arr.indexOf(v) === i);
  const sizeLabel = (kg) => kg + ' กก.';
  const fieldOf = (p, key) => String(key === 'cat' ? p.category || '' : key === 'unit' ? p.unit : p.sizeKg);

  /** ข้าวที่ตรงกับตัวกรองทั้งหมด (ยกเว้นตัวกรอง skip) — ใช้นับจำนวนบนปุ่มด้วย */
  function filtered(skip) {
    const words = F.q.toLowerCase().replace(/กิโลกรัม|กิโล|กก\.?|kg\.?/g, ' ').split(/\s+/).filter(Boolean);
    return S.products.filter((p) => {
      if (skip !== 'cat' && F.cat && fieldOf(p, 'cat') !== F.cat) return false;
      if (skip !== 'unit' && F.unit && fieldOf(p, 'unit') !== F.unit) return false;
      if (skip !== 'size' && F.size && fieldOf(p, 'size') !== F.size) return false;
      if (!words.length) return true;
      const hay = [p.name, p.detail, p.category, p.unit, p.sku].join(' ').toLowerCase();
      // ตัวเลขล้วน = ค้นตามน้ำหนัก เช่น "5" หรือ "5 กก." ได้เฉพาะข้าวถุงละ 5 กก.
      return words.every((w) => (/^\d+(\.\d+)?$/.test(w) ? Number(w) === Number(p.sizeKg) : hay.indexOf(w) >= 0));
    });
  }

  /* ตัวกรอง 3 แบบ: ปุ่มบนแถบ → แผ่นเลือกเลื่อนขึ้นจากด้านล่าง (ตัวเลือกเยอะก็ยังอ่านง่าย) */
  const FILTERS = [
    { key: 'cat', label: 'หมวด', title: 'เลือกหมวดข้าว', all: 'ทุกหมวด', fmt: (v) => v },
    { key: 'unit', label: 'หน่วย', title: 'เลือกหน่วย', all: 'ทุกหน่วย', fmt: (v) => v },
    { key: 'size', label: 'น้ำหนัก', title: 'เลือกน้ำหนักต่อหน่วย', all: 'ทุกน้ำหนัก', fmt: sizeLabel },
  ];

  function filterValues(key) {
    if (key === 'size') return uniq(S.products.map((p) => Number(p.sizeKg) || 0).filter((k) => k > 0)).sort((a, b) => a - b).map(String);
    const vals = uniq(S.products.map((p) => fieldOf(p, key)));
    return vals.sort((a, b) => a.localeCompare(b, 'th'));
  }

  function filterBar() {
    const avail = FILTERS.filter((f) => filterValues(f.key).length >= 2);
    if (!avail.length) return '';
    const btns = avail.map((f) => {
      const on = !!F[f.key];
      return '<button type="button" class="fbtn' + (on ? ' is-on' : '') + '" data-act="fsheet" data-k="' + f.key + '" aria-haspopup="dialog"' +
        ' aria-label="' + esc(f.label + ': ' + (on ? f.fmt(F[f.key]) : f.all)) + '">' +
        '<span class="fbtn-val">' + esc(f.label) + '</span>' +
        '<span class="fbtn-ic" aria-hidden="true">' + icon('chevron') + '</span></button>';
    });
    const pills = avail.filter((f) => F[f.key]).map((f) =>
      '<button type="button" class="fpill" data-act="funset" data-k="' + f.key + '" aria-label="เอาตัวกรอง ' + esc(f.fmt(F[f.key])) + ' ออก">' +
      '<span>' + esc(f.fmt(F[f.key])) + '</span>' + icon('x') + '</button>');
    return '<div class="fbar fbar-' + btns.length + '">' + btns.join('') + '</div>' +
      (pills.length ? '<div class="fpills">' + pills.join('') + '</div>' : '');
  }

  function shopFilters() {
    return '<section class="shop-filter" aria-label="ค้นหาข้าว">' +
      '<label class="f-search">' + icon('search') + '<span class="sr-only">ค้นหาข้าว</span>' +
      '<input type="search" class="input" id="shop-q" placeholder="ค้นหา เช่น หอมมะลิ, 5 กก., กระสอบ" value="' + esc(F.q) + '" autocomplete="off" enterkeyhint="search"></label>' +
      '<div id="f-rows">' + filterBar() + '</div></section>';
  }

  /** แผ่นเลือกตัวกรอง — แสดงจำนวนข้าวของแต่ละตัวเลือก (ตามตัวกรองอื่นที่เลือกอยู่) */
  /** แผ่นเลือกขนาดตัวอักษร: 3 ตัวเลือกใหญ่ เห็นตัวอย่างขนาดจริง แตะแล้วเปลี่ยนทันที */
  function openSizeSheet() {
    const cur = document.documentElement.dataset.size || 'l';
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = '<div class="modal sheet size-sheet" role="dialog" aria-modal="true" aria-labelledby="size-title">' +
      '<div class="sheet-head"><h2 id="size-title" class="modal-title">ขนาดตัวอักษร</h2>' +
      '<button type="button" class="sheet-x" data-x aria-label="ปิด">' + icon('x') + '</button></div>' +
      '<p class="size-hint">เลือกขนาดที่อ่านสบายตา เปลี่ยนได้ตลอดเวลา</p>' +
      '<div class="size-list" role="radiogroup" aria-labelledby="size-title">' + SIZES.map((x) => {
        const sel = x.id === cur;
        return '<button type="button" class="size-opt' + (sel ? ' is-sel' : '') + '" role="radio" aria-checked="' + sel + '" data-size="' + x.id + '">' +
          '<span class="size-radio" aria-hidden="true">' + (sel ? icon('check') : '') + '</span>' +
          '<span class="size-body"><span class="size-name">' + x.label + '</span>' +
          '<span class="size-sample" style="font-size:' + x.px + 'px">ข้าวหอมมะลิ 5 กก.</span></span></button>';
      }).join('') + '</div>' +
      '<button type="button" class="btn btn-primary btn-block size-done" data-x>เสร็จแล้ว</button></div>';

    const close = () => {
      wrap.classList.remove('show');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => wrap.remove(), 180);
      const btn = document.querySelector('.tb-size');
      if (btn) btn.focus({ preventScroll: true });
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    wrap.addEventListener('click', (e) => {
      const o = e.target.closest('.size-opt');
      if (o) {
        applySize(o.dataset.size);
        wrap.querySelectorAll('.size-opt').forEach((b) => {
          const on = b === o;
          b.classList.toggle('is-sel', on);
          b.setAttribute('aria-checked', on);
          b.querySelector('.size-radio').innerHTML = on ? icon('check') : '';
        });
        const tb = document.querySelector('.tb-size');
        if (tb) tb.setAttribute('aria-label', 'ขนาดตัวอักษร (ตอนนี้: ' + fontSizeLabel() + ') แตะเพื่อเปลี่ยน');
        return;
      }
      if (e.target === wrap || e.target.closest('[data-x]')) close();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    requestAnimationFrame(() => {
      wrap.classList.add('show');
      const sel = wrap.querySelector('.size-opt.is-sel');
      if (sel) sel.focus({ preventScroll: true });
    });
  }

  function openFilterSheet(key) {
    const f = FILTERS.find((x) => x.key === key);
    const pool = filtered(key);
    const opts = [{ v: '', label: f.all, n: countGroups(pool) }].concat(filterValues(key).map((v) => ({
      v, label: f.fmt(v), n: countGroups(pool.filter((p) => fieldOf(p, key) === v)),
    })));
    const withSearch = opts.length > 10;

    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    const row = (o) => {
      const sel = F[key] === o.v;
      return '<button type="button" class="opt' + (sel ? ' is-sel' : '') + '" data-v="' + esc(o.v) + '" role="option" aria-selected="' + sel + '"' +
        (o.n || sel ? '' : ' disabled') + ' data-s="' + esc(o.label.toLowerCase()) + '">' +
        '<span class="opt-label">' + esc(o.label) + '</span>' +
        '<span class="opt-n">' + o.n + '</span>' +
        '<span class="opt-check" aria-hidden="true">' + (sel ? icon('check') : '') + '</span></button>';
    };
    wrap.innerHTML = '<div class="modal sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">' +
      '<div class="sheet-head"><h2 id="sheet-title" class="modal-title">' + esc(f.title) + '</h2>' +
      '<button type="button" class="sheet-x" data-x aria-label="ปิด">' + icon('x') + '</button></div>' +
      (withSearch ? '<label class="f-search sheet-search">' + icon('search') + '<span class="sr-only">ค้นหา' + esc(f.label) + '</span>' +
        '<input type="search" class="input" placeholder="พิมพ์ชื่อ' + esc(f.label) + '" autocomplete="off"></label>' : '') +
      '<div class="opt-list" role="listbox" aria-label="' + esc(f.title) + '">' + opts.map(row).join('') +
      '<p class="opt-none" hidden>ไม่พบ' + esc(f.label) + 'ที่ค้นหา</p></div></div>';

    const prevFocus = document.activeElement;
    const close = () => {
      wrap.classList.remove('show');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => wrap.remove(), 180);
      if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    wrap.addEventListener('click', (e) => {
      const o = e.target.closest('.opt');
      if (o && !o.disabled) {
        F[key] = o.dataset.v;
        close();
        refreshShop();
        const list = document.getElementById('prod-list');
        if (list && list.getBoundingClientRect().top < 0) list.scrollIntoView({ block: 'start' });
        return;
      }
      if (e.target === wrap || e.target.closest('[data-x]')) close();
    });
    const q = wrap.querySelector('.sheet-search input');
    if (q) {
      q.addEventListener('input', () => {
        const t = q.value.trim().toLowerCase();
        let shown = 0;
        wrap.querySelectorAll('.opt').forEach((el) => {
          const hit = !t || el.dataset.v === '' || el.dataset.s.indexOf(t) >= 0;
          el.hidden = !hit; if (hit) shown++;
        });
        wrap.querySelector('.opt-none').hidden = shown > 1;
      });
    }
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    requestAnimationFrame(() => {
      wrap.classList.add('show');
      const sel = wrap.querySelector('.opt.is-sel');
      if (sel) sel.scrollIntoView({ block: 'center' });
      (sel || wrap.querySelector('.sheet-x')).focus({ preventScroll: true });
    });
  }

  function prodListHtml() {
    const list = filtered();
    const active = F.q || F.cat || F.unit || F.size;
    if (!list.length) {
      return '<div class="empty">' + icon('search') + '<p>ไม่พบข้าวที่ค้นหา</p>' +
        '<button type="button" class="btn btn-ghost" data-act="filter-clear">ดูข้าวทั้งหมด</button></div>';
    }
    const groups = groupsOf(list);
    return (active ? '<div class="f-count"><span>พบ <b>' + groups.length + '</b> จาก ' + countGroups(S.products) + ' ชนิด</span>' +
      '<button type="button" class="linkbtn" data-act="filter-clear">ล้างตัวกรอง</button></div>' : '') +
      groups.map(prodCard).join('');
  }

  /* ---------- ข้าวชื่อเดียวกัน หลายขนาด/หน่วย → การ์ดเดียว เลือกขนาดได้ ---------- */
  const gkey = (p) => String(p.name || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const variantLabel = (p) => (Number(p.sizeKg) ? p.sizeKg + ' กก.' : '') + (p.unit ? (Number(p.sizeKg) ? ' / ' : '') + p.unit : '');
  const VSEL = {}; // ขนาดที่เลือกไว้ของแต่ละชื่อ
  const OPEN = new Set(); // สินค้าที่ลูกค้ากด "เลือกสินค้านี้" แล้ว (จึงแสดงปุ่มขนาด/จำนวน)
  const isOpen = (vs) => OPEN.has(gkey(vs[0])) || vs.some((v) => cart.items[v.id] > 0);

  /** การ์ดที่ยังไม่ได้เลือก: เห็นรูป ชื่อ ขนาดที่มี และปุ่ม "เลือกสินค้านี้" เท่านั้น */
  function prodClosed(vs) {
    const p = vs[0];
    const img = (vs.find((v) => v.image) || p).image;
    const sizes = vs.length > 1
      ? 'มี ' + vs.length + ' ขนาด: ' + vs.map((v) => esc(Number(v.sizeKg) ? v.sizeKg + ' กก.' : v.unit)).join(', ')
      : esc(p.unit) + 'ละ ' + p.sizeKg + ' กิโลกรัม';
    return '<article class="prod is-closed" data-ids="' + esc(vs.map((v) => v.id).join(' ')) + '" data-act="pick" data-id="' + esc(p.id) + '" role="button" tabindex="0" aria-expanded="false" aria-label="' + esc(p.name) + ' — แตะเพื่อเลือกขนาดและจำนวน">' +
      '<img class="prod-img" src="' + esc(R.imgUrl(img)) + '" alt="" width="104" height="104" loading="lazy" onerror="this.src=\'assets/rice-placeholder.svg\'">' +
      '<div><div class="prod-name">' + esc(p.name) + '</div>' + (p.detail ? '<div class="prod-detail">' + esc(p.detail) + '</div>' : '') +
      '<div class="prod-size">' + sizes + '</div></div>' +
      '<span class="prod-go" aria-hidden="true">' + icon('chevron') + '</span>' +
      '</article>';
  }
  /** ปุ่มเปลี่ยนใจ (แสดงเมื่อยังไม่ได้ใส่จำนวน) */
  const unpickBtn = (vs) => vs.some((v) => cart.items[v.id] > 0) ? ''
    : '<button type="button" class="unpick" data-act="unpick" data-id="' + esc(vs[0].id) + '">ไม่เลือกสินค้านี้</button>';

  /** ล้างค่าหน้าเลือกข้าว (ขั้นที่ 1): รายการ/จำนวน ขนาดที่เลือก คำค้น และตัวกรอง — ใช้ตอนกลับหน้าแรกหรือสั่งเสร็จ */
  function resetShop() {
    cart = newCart(); saveCart();
    Object.keys(VSEL).forEach((k) => { delete VSEL[k]; });
    F.q = ''; F.cat = ''; F.unit = ''; F.size = '';
    OPEN.clear();
  }

  /** จัดกลุ่มตามชื่อ (เรียงตามลำดับสินค้าเดิม) ภายในกลุ่มเรียงน้ำหนักน้อย → มาก */
  function groupsOf(list) {
    const m = new Map();
    list.forEach((p) => { const k = gkey(p); if (!m.has(k)) m.set(k, []); m.get(k).push(p); });
    return [...m.values()].map((vs) => vs.sort((a, b) => (Number(a.sizeKg) - Number(b.sizeKg)) || String(a.unit).localeCompare(String(b.unit), 'th')));
  }
  const countGroups = (list) => new Set(list.map(gkey)).size;

  function selectedVariant(vs) {
    const k = gkey(vs[0]);
    return vs.find((p) => p.id === VSEL[k]) || vs.find((p) => cart.items[p.id] > 0) || null;   // ไม่เลือกขนาดให้ล่วงหน้า
  }

  /** การ์ดของกลุ่ม — ถ้ามีขนาดเดียวจะหน้าตาเหมือนการ์ดสินค้าปกติ */
  function prodCard(vs) {
    if (!isOpen(vs)) return prodClosed(vs);
    if (vs.length === 1) return prodRow(vs[0], vs);
    const sel = selectedVariant(vs);
    const p = sel || vs[0];
    const inCart = vs.filter((v) => cart.items[v.id] > 0);
    const img = (p.image ? p : vs.find((v) => v.image) || p).image;
    const chips = vs.map((v) => {
      const q = cart.items[v.id] || 0;
      return '<button type="button" class="vchip" data-act="variant" data-id="' + esc(v.id) + '" aria-pressed="' + (!!sel && v.id === sel.id) + '">' +
        '<span class="vchip-kg">' + esc(Number(v.sizeKg) ? v.sizeKg + ' กก.' : v.unit) + '</span>' +
        (Number(v.sizeKg) ? '<span class="vchip-unit">' + esc(v.unit) + '</span>' : '') +
        (q ? '<b class="vchip-n" aria-label="เลือกแล้ว ' + q + ' ' + esc(v.unit) + '">' + q + '</b>' : '') + '</button>';
    }).join('');
    return '<article class="prod is-open' + (inCart.length ? ' is-on' : '') + '" data-ids="' + esc(vs.map((v) => v.id).join(' ')) + '">' +
      '<img class="prod-img" src="' + esc(R.imgUrl(img)) + '" alt="" width="104" height="104" loading="lazy" onerror="this.src=\'assets/rice-placeholder.svg\'">' +
      '<div><div class="prod-name">' + esc(p.name) + '</div>' + (p.detail ? '<div class="prod-detail">' + esc(p.detail) + '</div>' : '') +
      '<div class="prod-size">มี ' + vs.length + ' ขนาด</div></div>' +
      '<div class="variants"><div class="variants-label">เลือกขนาด / หน่วย</div><div class="vchips" role="group" aria-label="ขนาดของ' + esc(p.name) + '">' + chips + '</div></div>' +
      (sel ? qtyControl(sel) : '<div class="prod-qty"><p class="pick-first">' + icon('chevron') + 'เลือกขนาด / หน่วยด้านบนก่อน</p></div>') + unpickBtn(vs) + '</article>';
  }

  function qtyControl(p) {
    const qty = cart.items[p.id] || 0;
    return '<div class="prod-qty">' + (qty
      ? '<div class="stepper" role="group" aria-label="จำนวน' + esc(p.name + ' ' + variantLabel(p)) + '">' +
        '<button type="button" class="st-minus" data-act="dec" data-id="' + esc(p.id) + '" aria-label="ลดจำนวน">' + icon('minus') + '</button>' +
        '<button type="button" class="st-qty" data-act="qty" data-id="' + esc(p.id) + '" aria-label="พิมพ์จำนวน ตอนนี้ ' + qty + ' ' + esc(p.unit) + '">' + qty + '<small>' + esc(p.unit) + '</small></button>' +
        '<button type="button" class="st-plus" data-act="inc" data-id="' + esc(p.id) + '" aria-label="เพิ่มจำนวน">' + icon('plus') + '</button></div>'
      : '<button type="button" class="btn btn-ghost btn-block" data-act="inc" data-id="' + esc(p.id) + '">' + icon('plus') + ' เลือก' + esc(p.unit) + 'ละ ' + p.sizeKg + ' กก.</button>') +
      '</div>';
  }

  /** วาดการ์ดที่มีสินค้า id นี้ใหม่ (หลังเปลี่ยนจำนวน/ขนาด) */
  function redrawCard(id) {
    const el = document.querySelector('.prod[data-ids~="' + CSS.escape(id) + '"]');
    if (!el) return null;
    const p = productById(id);
    const vs = groupsOf(filtered()).find((g) => g.some((v) => v.id === id)) || [p];
    el.outerHTML = prodCard(vs);
    return document.querySelector('.prod[data-ids~="' + CSS.escape(id) + '"]');
  }

  /** อัปเดตเฉพาะรายการข้าวและปุ่มกรอง — ช่องค้นหาไม่หลุดโฟกัสระหว่างพิมพ์ */
  function refreshShop() {
    const list = document.getElementById('prod-list');
    if (list) list.innerHTML = prodListHtml();
    const rows = document.getElementById('f-rows');
    if (rows) rows.innerHTML = filterBar();
  }

  function prodRow(p) {
    const qty = cart.items[p.id] || 0;
    return '<article class="prod is-open' + (qty ? ' is-on' : '') + '" data-ids="' + esc(p.id) + '">' +
      '<img class="prod-img" src="' + esc(R.imgUrl(p.image)) + '" alt="" width="104" height="104" loading="lazy" onerror="this.src=\'assets/rice-placeholder.svg\'">' +
      '<div><div class="prod-name">' + esc(p.name) + '</div>' + (p.detail ? '<div class="prod-detail">' + esc(p.detail) + '</div>' : '') +
      '<div class="prod-size">' + esc(p.unit) + 'ละ ' + p.sizeKg + ' กิโลกรัม</div></div>' +
      qtyControl(p) + unpickBtn([p]) + '</article>';
  }

  function shopBar() {
    const s = cartSummary();
    return s.count
      ? '<div class="actionbar-sum"><span>เลือกแล้ว</span><b>' + esc(s.text) + ' (' + s.kg + ' กก.)</b></div>' +
        '<button type="button" class="btn btn-primary btn-lg btn-block" data-act="go" data-to="#/purpose">ถัดไป ' + icon('chevron') + '</button>'
      : '<button type="button" class="btn btn-primary btn-lg btn-block" disabled>เลือกข้าวอย่างน้อย 1 อย่าง</button>';
  }

  function setQty(id, n) {
    n = Math.max(0, Math.min(9999, Math.floor(Number(n) || 0)));
    if (n) cart.items[id] = n; else delete cart.items[id];
    saveCart();
    const card = redrawCard(id);
    const btn = card && card.querySelector('[data-act="inc"][data-id="' + CSS.escape(id) + '"]');
    if (btn) btn.focus({ preventScroll: true });
    const bar = document.querySelector('.actionbar-in');
    if (bar) bar.innerHTML = shopBar();
  }

  async function askQty(id) {
    const p = productById(id);
    const cur = cart.items[id] || 0;
    let val = null;
    const ok = await R.modal({
      title: 'พิมพ์จำนวน' + p.unit,
      html: '<p class="muted">' + esc(p.name) + ' (' + esc(p.unit) + 'ละ ' + p.sizeKg + ' กก.)</p>' +
        '<label class="field" style="margin:.8rem 0 0"><span class="sr-only">จำนวน</span>' +
        '<input id="qty-input" class="input" type="number" inputmode="numeric" min="0" max="9999" value="' + cur + '" style="font-size:2rem;text-align:center;font-weight:700"></label>',
      actions: [{ label: 'ตกลง', value: true, kind: 'primary' }, { label: 'ยกเลิก', value: false, kind: 'ghost' }],
      onAction: (v, wrap) => { if (v) val = wrap.querySelector('#qty-input').value; },
    });
    if (ok) setQty(id, val);
  }

  /* ---------- ขั้นที่ 2: วัตถุประสงค์ ---------- */

  VIEWS.purpose = function () {
    if (!cart.purpose && S.customer.purpose) {
      cart.purpose = S.customer.purpose;
      if (!cart.purposeNote) cart.purposeNote = S.customer.purposeNote || '';
      saveCart();
    }
    const tiles = R.PURPOSES.map((p) => tile({ act: 'purpose', id: p.id, icon: p.icon, label: p.label, sub: p.hint, on: cart.purpose === p.id, wide: p.id === 'other' })).join('');
    return {
      back: '#/shop', top: 'สั่งซื้อข้าวสาร',
      body: stepHead(2, 'กรุณาเลือกประเภทการใช้งาน', 'เพื่อให้ทางร้านประเมินราคาที่คุ้มค่าที่สุด') +
        '<div class="tiles">' + tiles + '</div><div id="purpose-note">' + purposeNoteField() + '</div>',
      bar: '<button type="button" class="btn btn-primary btn-lg btn-block" data-act="purpose-next"' + (cart.purpose ? '' : ' disabled') + '>ถัดไป ' + icon('chevron') + '</button>',
    };
  };

  function purposeNoteField() {
    const p = R.PURPOSES.find((x) => x.id === cart.purpose);
    if (!p || !p.notePrompt) return '';
    return '<label class="field section"><span class="field-label">' + esc(p.notePrompt) + '</span>' +
      '<input class="input" data-bind="purposeNote" value="' + esc(cart.purposeNote) + '" maxlength="200" autocomplete="off"></label>';
  }

  /* ---------- ขั้นที่ 3: การรับข้าว ---------- */

  VIEWS.delivery = function () {
    if (!cart.deliveryMethod) cart.deliveryMethod = 'delivery';
    if (cart.deliveryMethod === 'delivery' && !cart.address && !cart.lat) {
      cart.address = S.customer.address || '';
      cart.lat = S.customer.lat || null; cart.lng = S.customer.lng || null;
    }
    saveCart();
    const st = S.settings;
    const shopMap = R.mapUrl(st.SHOP_LAT, st.SHOP_LNG);
    let detail;
    if (cart.deliveryMethod === 'delivery') {
      detail = '<section class="section"><h2 class="section-title">ระบุที่อยู่ในการจัดส่ง</h2><div class="panel">' +
        '<label class="field"><span class="sr-only">ที่อยู่ในการจัดส่ง</span>' +
        '<textarea class="textarea" data-bind="address" rows="3" maxlength="500" placeholder="บ้านเลขที่ หมู่ ซอย ถนน ตำบล">' + esc(cart.address) + '</textarea>' +
        '<span class="field-hint">ถ้าส่งไปวัดหรือที่อื่น แก้ที่อยู่ตรงนี้ได้เลย</span></label>' +
        locBlock('cart', cart.lat, cart.lng) + '</div></section>';
    } else {
      detail = '<section class="section"><h2 class="section-title">ที่อยู่ร้าน</h2><div class="panel">' +
        '<p><strong>' + esc(shopName()) + '</strong></p>' +
        (st.SHOP_ADDRESS ? '<p>' + esc(st.SHOP_ADDRESS) + '</p>' : '') +
        (st.SHOP_HOURS ? '<p class="muted">เปิด ' + esc(st.SHOP_HOURS) + '</p>' : '') +
        (shopMap ? '<p style="margin-top:.6rem"><a href="' + shopMap + '" target="_blank" rel="noopener">' + icon('map') + ' ดูแผนที่ไปร้าน</a></p>' : '') +
        '</div></section>';
    }
    normalizeWant();
    const closed = closedNow();
    const status = shopStatus(new Date());
    const nxt = nextOpenDay();
    const chip = (mode, label, off) => '<button type="button" class="chip" data-act="want" data-id="' + mode + '" aria-pressed="' + (cart.wantMode === mode) + '"' + (off ? ' disabled' : '') + '>' + label + '</button>';
    const start = new Date(); if (closed) start.setDate(start.getDate() + 1);
    const minDate = ymd(start);
    const badDate = cart.wantMode === 'date' && cart.wantDate && !openOn(new Date(cart.wantDate + 'T12:00:00'));
    return {
      back: '#/purpose', top: 'สั่งซื้อข้าวสาร',
      body: stepHead(3, 'กรุณาเลือกประเภทการจัดส่ง', '') +
        '<div class="tiles one">' +
        tile({ act: 'method', id: 'delivery', icon: 'truck', label: 'ส่งตามที่อยู่ผู้รับ', on: cart.deliveryMethod === 'delivery' }) +
        tile({ act: 'method', id: 'pickup', icon: 'store', label: 'มารับเอง', on: cart.deliveryMethod === 'pickup' }) +
        '</div>' + detail +
        '<section class="section"><h2 class="section-title">ต้องการใช้สินค้าเมื่อไหร่</h2>' +
        (closed ? '<p class="want-note">' + icon('clock') + '<span><b>ตอนนี้ร้านปิดอยู่</b>' + (status ? ' (' + esc(status.sub.split(' · ')[0]) + ')' : '') +
          ' เลือกรับข้าวได้ตั้งแต่' + (nxt.label === 'พรุ่งนี้' ? 'พรุ่งนี้' : nxt.label) + 'เป็นต้นไป</span></p>' : '') +
        '<div class="chips">' +
        chip('asap', 'ตอนนี้', closed) +
        chip('tomorrow', nxt.label + ' ' + nxt.date.getDate() + ' ' + R.dateTH(nxt.date.toISOString()).split(' ')[1]) +
        chip('date', 'เลือกวัน') + '</div>' +
        (cart.wantMode === 'date' ? '<label class="field" style="margin-top:.8rem"><span class="sr-only">วันที่ต้องการ</span><input type="date" class="input' + (badDate ? ' is-invalid' : '') + '" data-bind="wantDate" data-rerender="1" min="' + minDate + '" value="' + esc(cart.wantDate) + '">' +
          (badDate ? '<span class="field-error">ร้านหยุดวัน' + DAY_TH[new Date(cart.wantDate + 'T12:00:00').getDay()] + ' กรุณาเลือกวันอื่น</span>' : '') +
          (S.settings.SHOP_HOURS ? '<span class="field-hint">ร้านเปิด ' + esc(S.settings.SHOP_HOURS) + '</span>' : '') + '</label>' : '') +
        '</section>',
      bar: '<button type="button" class="btn btn-primary btn-lg btn-block" data-act="delivery-next">ถัดไป ' + icon('chevron') + '</button>',
    };
  };

  function locBlock(target, lat, lng) {
    return '<button type="button" class="btn btn-ghost btn-block loc-btn" data-act="locate" data-id="' + target + '">' + icon('pin') + ' ใช้ตำแหน่งที่อยู่ตอนนี้</button>' +
      '<div id="loc-status">' + locStatus(lat, lng, target) + '</div>';
  }
  function locStatus(lat, lng, target) {
    if (!lat || !lng) return '<span class="field-hint">กดปุ่มนี้ตอนอยู่ที่บ้าน ร้านจะเห็นจุดบนแผนที่</span>';
    return '<div class="loc-ok">' + icon('check') + '<span>ได้ตำแหน่งแล้ว</span> <a href="' + R.mapUrl(lat, lng) + '" target="_blank" rel="noopener">ดูแผนที่</a>' +
      ' <button type="button" class="btn-quiet" style="border:0;background:none;padding:.2rem" data-act="unlocate" data-id="' + target + '">ลบ</button></div>';
  }

  /* ---------- ขั้นที่ 4: ตรวจสอบ ---------- */

  VIEWS.review = function () {
    const c = S.customer;
    const p = R.purposeOf(cart.purpose);
    const items = cartLines().map(({ p: pr, qty }) =>
      '<li><span class="bi-name">' + esc(pr.name) + '</span><span class="bi-sub">' + esc(pr.detail) + ' (' + esc(pr.unit) + 'ละ ' + pr.sizeKg + ' กก.)</span>' +
      '<span class="bi-amt">' + qty + ' ' + esc(pr.unit) + '</span></li>').join('');
    const where = cart.deliveryMethod === 'pickup'
      ? 'มารับเองที่ร้าน'
      : 'ส่งถึงที่: ' + (cart.address || 'ตามตำแหน่งบนแผนที่');
    return {
      back: '#/delivery', top: 'สั่งซื้อข้าวสาร',
      body: stepHead(4, 'ตรวจสอบก่อนส่ง', 'หากข้อมูลถูกต้อง กรุณากดปุ่มสีเขียวด้านล่าง') +
        '<div class="bill">' +
        '<div class="bill-head"><div class="bill-shop">' + esc(shopName()) + '</div><div class="bill-title">ใบสั่งข้าว</div>' +
        '<div class="bill-meta">วันที่ ' + R.dateTH(new Date().toISOString()) + '</div></div>' +
        '<ul class="bill-items">' + items + '</ul>' +
        '<p style="text-align:right;margin-top:.3rem"><a class="edit" href="#/shop">แก้ไขรายการข้าว</a></p>' +
        '<dl class="bill-info">' +
        infoRow('ซื้อไป', esc(p.label) + (cart.purposeNote ? ' (' + esc(cart.purposeNote) + ')' : ''), '#/purpose') +
        infoRow('รับข้าว', esc(where) + (cart.lat && cart.deliveryMethod === 'delivery' ? ' (มีจุดบนแผนที่)' : ''), '#/delivery') +
        infoRow('วันที่ต้องการ', esc(wantText()), '#/delivery') +
        infoRow('ผู้สั่ง', esc(c.fullName) + '<br>' + esc(R.phoneFmt(c.phone)), '#/profile') +
        '</dl>' +
        '<p class="bill-wait"><strong>หมายเหตุ :</strong> ทางร้านจะสรุปยอดรวมค่าจัดส่ง และแจ้งรายละเอียดกลับทาง LINE (ในวันและเวลาทำการ)</p>' +
        '</div>' +
        '<label class="field"><span class="field-label">ฝากข้อความถึงร้าน (ไม่จำเป็นต้องระบุ)</span>' +
        '<textarea class="textarea" data-bind="note" rows="2" maxlength="500" placeholder="เช่น ส่งช่วงเช้า หรือ โทรก่อนมาส่ง">' + esc(cart.note) + '</textarea></label>',
      bar: '<button type="button" class="btn btn-go btn-lg btn-block" data-act="submit">' + icon('check') + ' ส่งใบสั่งซื้อให้ร้าน</button>',
    };
  };

  function infoRow(label, valueHtml, editHref) {
    return '<div><dt>' + label + '</dt><dd>' + valueHtml + (editHref ? ' <a class="edit" href="' + editHref + '">แก้ไข</a>' : '') + '</dd></div>';
  }

  async function submitOrder() {
    if (cart.wantMode === 'asap' && closedNow()) {
      normalizeWant();
      R.toast('ร้านเพิ่งปิด เปลี่ยนเป็นรับข้าว' + nextOpenDay().label + 'ให้แล้ว ตรวจแล้วกดส่งอีกครั้ง', 'err');
      render();
      return;
    }
    const payload = {
      items: cartLines().map(({ p, qty }) => ({ productId: p.id, qty })),
      purpose: cart.purpose, purposeNote: cart.purposeNote,
      deliveryMethod: cart.deliveryMethod, address: cart.address, lat: cart.lat, lng: cart.lng,
      wantDate: wantText(), note: cart.note,
    };
    R.busy(true, 'กำลังส่งใบสั่งข้าว...');
    try {
      const o = await R.api('createOrder', { order: payload });
      S.orders.unshift(o);
      S.customer.purpose = cart.purpose; S.customer.purposeNote = cart.purposeNote;
      resetShop();
      R.sendChat('สั่งข้าว #' + o.orderId + '\n' + o.items.map((i) => i.name + ' ' + i.sizeKg + ' กก. × ' + i.qty + ' ' + i.unit).join('\n') + '\nซื้อไป: ' + R.purposeOf(o.purpose).label);
      go('#/done/' + encodeURIComponent(o.orderId));
    } catch (e) {
      R.toast(e.message, 'err');
    } finally {
      R.busy(false);
    }
  }

  /* ---------- ส่งสำเร็จ ---------- */

  VIEWS.done = function (id) {
    return {
      top: shopName(),
      body: '<div class="done-hero"><div class="big-check">' + icon('check') + '</div>' +
        '<h1 class="page-title">ส่งใบสั่งซื้อให้ร้านแล้ว</h1>' +
        '<div class="order-no">เลขที่ ' + esc(id) + '</div>' +
        '<p>ร้านกำลังคิดราคา แล้วจะส่งราคามาทาง LINE' + (S.settings.QUOTE_TIME ? ' ' + esc(S.settings.QUOTE_TIME) : '') + '</p>' +
        '<p style="margin-top:.5rem">ตอนนี้ไม่ต้องทำอะไรเพิ่ม รอข้อความจากร้านได้เลย</p></div>' +
        '<div class="stack">' +
        (R.inLineApp() ? '<button type="button" class="btn btn-primary btn-lg btn-block" data-act="close">' + icon('chat') + ' กลับไปที่แชท LINE</button>' : '') +
        '<button type="button" class="btn btn-ghost btn-lg btn-block" data-act="go" data-to="#/order/' + esc(id) + '">ดูใบสั่งข้าวนี้</button>' +
        '<button type="button" class="btn btn-quiet btn-block" data-act="go" data-to="#/">กลับหน้าแรก</button></div>',
    };
  };

  /* ---------- คำสั่งซื้อของฉัน ---------- */

  VIEWS.orders = function () {
    const list = S.orders.length
      ? '<div class="order-list">' + S.orders.map(orderCard).join('') + '</div>'
      : '<div class="empty">' + icon('receipt') + '<p>ยังไม่เคยสั่งข้าว</p>' +
        '<button type="button" class="btn btn-primary btn-lg" style="margin-top:1rem" data-act="go" data-to="#/shop">สั่งซื้อข้าวสาร</button></div>';
    return {
      back: '#/', top: 'ประวัติการสั่ง',
      body: '<h1 class="page-title" style="margin-bottom:.9rem">ประวัติการสั่ง</h1>' + list,
    };
  };

  function orderCard(o) {
    const st = R.statusInfo(o);
    const items = (o.items || []).map((i) => esc(i.name) + ' ' + i.qty + ' ' + esc(i.unit)).join('<br>');
    return '<button type="button" class="order-card tone-' + st.tone + '-b" data-act="go" data-to="#/order/' + esc(o.orderId) + '">' +
      '<div class="oc-top"><span class="oc-id">#' + esc(o.orderId) + '</span><span class="pill tone-' + st.tone + '">' + esc(st.label) + '</span></div>' +
      '<div class="oc-items">' + items + '</div>' +
      '<div class="oc-top"><span class="muted">' + R.dateTH(o.createdAt) + '</span>' + (o.total ? '<span class="oc-total">฿' + money(o.total) + '</span>' : '') + '</div>' +
      (st.action ? '<div class="oc-next" style="margin-top:.4rem">' + icon('chevron') + esc(st.next) + '</div>' : '') +
      '</button>';
  }

  /* ---------- รายละเอียดคำสั่งซื้อ ---------- */

  VIEWS.order = function (id) {
    const o = S.orders.find((x) => x.orderId === id);
    if (!o) {
      loadOrder(id);
      return { back: '#/orders', top: 'ใบสั่งข้าว', body: '<div class="splash" style="min-height:40vh"><div>' + R.sackLoader('5.5rem') + '<p class="loading-text">กำลังเปิดใบสั่งข้าว...</p></div></div>' };
    }
    const st = R.statusInfo(o);
    const s = S.settings;
    let action = '', bar = '';

    if (o.status === 'quoted') {
      const allowCod = /^(true|1|yes|ใช่)$/i.test(String(s.ALLOW_COD));
      if (!payChoice[o.orderId] && !allowCod) payChoice[o.orderId] = 'transfer';
      const pick = payChoice[o.orderId] || '';
      action = '<section class="section"><h2 class="section-title">เลือกวิธีจ่ายเงิน</h2><div class="tiles one">' +
        tile({ act: 'pay', id: 'transfer', icon: 'qr', label: 'โอนเงิน / สแกน QR', sub: 'ใช้แอปธนาคาร แล้วส่งรูปสลิป', on: pick === 'transfer' }) +
        (allowCod ? tile({ act: 'pay', id: 'cod', icon: 'cash', label: o.deliveryMethod === 'pickup' ? 'จ่ายเงินสดตอนมารับ' : 'จ่ายเงินสดตอนรับข้าว', sub: o.deliveryMethod === 'pickup' ? 'จ่ายที่ร้าน' : 'จ่ายให้คนส่งข้าว', on: pick === 'cod' }) : '') +
        '</div></section>';
      bar = '<button type="button" class="btn btn-go btn-lg btn-block" data-act="confirm" data-id="' + esc(o.orderId) + '"' + (pick ? '' : ' disabled') + '>' +
        (pick ? icon('check') + ' ยืนยันสั่งข้าว ฿' + money(o.total) : 'เลือกวิธีจ่ายเงินก่อน') + '</button>';
    } else if (o.status === 'confirmed' && o.payMethod !== 'cod') {
      action = payPanel(o);
      bar = slipButton(o, 'ส่งรูปสลิป');
    } else if (o.status === 'slip') {
      action = '<div class="panel"><p>ร้านได้รับรูปสลิปแล้ว ถ้าส่งรูปผิด กดปุ่มด้านล่างเพื่อส่งใหม่</p>' +
        '<div style="margin-top:.8rem">' + slipButton(o, 'ส่งรูปสลิปใหม่', true) + '</div></div>';
    } else if (['done', 'cancelled'].indexOf(o.status) >= 0) {
      bar = '<button type="button" class="btn btn-primary btn-lg btn-block" data-act="reorder" data-id="' + esc(o.orderId) + '">' + icon('repeat') + ' สั่งแบบนี้อีกครั้ง</button>';
    }

    const canCancel = ['new', 'quoted', 'confirmed'].indexOf(o.status) >= 0;
    return {
      back: '#/orders', top: 'ใบสั่งข้าว #' + o.orderId,
      body:
        '<h1 class="page-title">ใบสั่งข้าว #' + esc(o.orderId) + '</h1>' +
        '<p class="page-lead" style="margin-bottom:.9rem">สั่งเมื่อ ' + R.dateTH(o.createdAt, true) + '</p>' +
        '<div class="status-box tone-' + st.tone + '">' + icon(st.icon) + '<strong>' + esc(st.label) + '</strong><span>' + esc(st.next) + '</span></div>' +
        billHtml(o, st) + action +
        (o.status !== 'cancelled' ? '<section class="section"><h2 class="section-title">ขั้นตอน</h2>' + timeline(o) + '</section>' : '') +
        '<div class="stack section">' +
        (s.SHOP_PHONE ? '<a class="btn btn-ghost btn-block" href="' + telLink() + '">' + icon('phone') + ' โทรถามร้าน ' + esc(mainPhone()) + '</a>' : '') +
        (canCancel ? '<button type="button" class="btn btn-danger btn-block" data-act="cancel" data-id="' + esc(o.orderId) + '">ยกเลิกการสั่งข้าวนี้</button>' : '') +
        '</div>',
      bar: bar,
    };
  };

  function billHtml(o, st) {
    const q = o.quote;
    const where = o.deliveryMethod === 'pickup' ? 'มารับเองที่ร้าน' : 'ส่งถึงที่' + (o.address ? ': ' + o.address : '');
    let items, totals = '';
    if (q && q.lines) {
      items = q.lines.map((l) =>
        '<li><span class="bi-name">' + esc(l.name) + (l.sizeKg ? ' ' + l.sizeKg + ' กก.' : '') + '</span>' +
        '<span class="bi-sub">' + l.qty + ' ' + esc(l.unit) + ' × ฿' + money(l.unitPrice) + '</span>' +
        '<span class="bi-amt">฿' + money(l.amount) + '</span></li>').join('');
      totals = '<div class="bill-rows">' +
        '<div class="bill-row"><span>ค่าข้าว</span><b>฿' + money(q.subtotal) + '</b></div>' +
        '<div class="bill-row"><span>' + (o.deliveryMethod === 'pickup' ? 'รับที่ร้าน' : 'ค่าส่ง') + '</span><b>' + (q.shippingFee > 0 ? '฿' + money(q.shippingFee) : 'ไม่มีค่าส่ง') + '</b></div>' +
        (q.discount > 0 ? '<div class="bill-row minus"><span>ส่วนลด</span><b>−฿' + money(q.discount) + '</b></div>' : '') +
        '</div><div class="bill-total"><span>ยอดที่ต้องจ่าย</span><b>฿' + money(q.total) + '</b></div>' +
        (q.note ? '<p class="bill-note"><strong>ข้อความจากร้าน:</strong> ' + esc(q.note) + '</p>' : '');
    } else {
      items = (o.items || []).map((i) =>
        '<li><span class="bi-name">' + esc(i.name) + '</span><span class="bi-sub">' + esc(i.detail || '') + ' (' + esc(i.unit) + 'ละ ' + i.sizeKg + ' กก.)</span>' +
        '<span class="bi-amt">' + i.qty + ' ' + esc(i.unit) + '</span></li>').join('');
      if (o.status === 'new') totals = '<p class="bill-wait">ร้านกำลังคิดราคา จะส่งมาทาง LINE</p>';
    }
    return '<div class="bill">' +
      '<div class="bill-head"><div class="bill-shop">' + esc(shopName()) + '</div><div class="bill-title">' + (q ? 'ใบแจ้งราคา' : 'ใบสั่งข้าว') + '</div>' +
      '<div class="bill-meta">เลขที่ ' + esc(o.orderId) + '</div>' +
      '<span class="stamp tone-' + st.tone + '">' + esc(st.label) + '</span></div>' +
      '<ul class="bill-items">' + items + '</ul>' + totals +
      '<dl class="bill-info">' +
      infoRow('ซื้อไป', esc(R.purposeOf(o.purpose).label) + (o.purposeNote ? ' (' + esc(o.purposeNote) + ')' : '')) +
      infoRow('รับข้าว', esc(where)) +
      (o.wantDate ? infoRow('วันที่ต้องการ', esc(o.wantDate)) : '') +
      (o.payMethod ? infoRow('จ่ายเงิน', o.payMethod === 'cod' ? 'เงินสด' : 'โอน / สแกนจ่าย') : '') +
      (o.note ? infoRow('ข้อความถึงร้าน', esc(o.note)) : '') +
      '</dl></div>';
  }

  function timeline(o) {
    const cod = o.payMethod === 'cod';
    const pickup = o.deliveryMethod === 'pickup';
    const doneCount = { new: 1, quoted: 2, confirmed: cod ? 3 : 2, slip: 2, paid: 3, shipping: 4, done: 5 }[o.status] || 0;
    const steps = [
      { t: 'สั่งข้าว', d: o.createdAt },
      { t: 'ร้านแจ้งราคา', d: o.quotedAt },
      { t: cod ? 'ยืนยันสั่งข้าว (จ่ายเงินสด)' : 'จ่ายเงิน', d: cod ? o.confirmedAt : o.paidAt },
      { t: pickup ? 'ข้าวพร้อมให้มารับ' : 'ร้านนำข้าวไปส่ง', d: o.shippedAt },
      { t: 'ได้รับข้าว', d: o.doneAt },
    ];
    return '<ol class="timeline">' + steps.map((s, i) => {
      const cls = i < doneCount ? 'done' : i === doneCount ? 'now' : '';
      return '<li class="' + cls + '"' + (cls === 'now' ? ' aria-current="step"' : '') + '><span class="dot">' + (cls === 'done' ? icon('check') : i + 1) + '</span>' +
        '<span class="tl-text"><strong>' + s.t + '</strong>' + (cls === 'done' && s.d ? '<span>' + R.dateTH(s.d, true) + '</span>' : '') + '</span></li>';
    }).join('') + '</ol>';
  }

  function payPanel(o) {
    const s = S.settings;
    const payload = R.promptpayPayload(s.PROMPTPAY_ID, o.total);
    const qr = payload ? R.qrDataUrl(payload, 8) : '';
    return '<section class="section"><h2 class="section-title">จ่ายเงิน</h2><div class="panel qr-card">' +
      (qr
        ? '<span class="pp-logo">พร้อมเพย์ PromptPay</span>' +
          '<div class="qr-amt">฿' + money(o.total) + '</div>' +
          '<img src="' + qr + '" alt="QR พร้อมเพย์ ยอด ' + money(o.total) + ' บาท" width="300" height="300">' +
          '<div class="payee"><span>ชื่อบัญชีผู้รับเงิน</span><strong>' + esc(payeeName()) + '</strong>' +
          '<small>ก่อนกดยืนยันในแอปธนาคาร ตรวจว่าชื่อผู้รับตรงกับชื่อนี้ ถ้าไม่ตรง อย่าโอน และโทรหาร้าน' +
          (s.SHOP_PHONE ? ' ' + phoneLinks() : '') + '</small></div>' +
          '<div class="qr-help"><strong>วิธีจ่าย</strong><ol>' +
          '<li>กดค้างที่รูป QR แล้วเลือก "บันทึกรูป"</li>' +
          '<li>เปิดแอปธนาคาร เลือก "สแกน" แล้วเลือกรูปที่บันทึกไว้</li>' +
          '<li>จ่ายเสร็จแล้ว กลับมากดปุ่ม "ส่งรูปสลิป" ด้านล่าง</li></ol></div>'
        : '<div class="qr-amt">฿' + money(o.total) + '</div>') +
      (s.BANK_INFO ? '<p class="qr-help">' + esc(s.BANK_INFO) + '</p>' : '') +
      '</div>' + safetyNote(true) + '</section>';
  }

  function slipButton(o, label, ghost) {
    return '<label class="btn ' + (ghost ? 'btn-ghost' : 'btn-go btn-lg') + ' btn-block file-btn">' + icon('camera') + ' ' + label +
      '<input type="file" accept="image/*" data-file="slip" data-id="' + esc(o.orderId) + '" aria-label="' + label + '"></label>';
  }

  async function loadOrder(id) {
    try {
      const o = await R.api('getOrder', { orderId: id });
      upsertOrder(o);
      render();
    } catch (e) {
      R.toast(e.message, 'err');
      go('#/orders');
    }
  }

  function upsertOrder(o) {
    const i = S.orders.findIndex((x) => x.orderId === o.orderId);
    if (i >= 0) S.orders[i] = o; else S.orders.unshift(o);
  }

  async function confirmOrder(id) {
    const o = S.orders.find((x) => x.orderId === id);
    const pay = payChoice[id];
    const payText = pay === 'cod' ? 'จ่ายเงินสด' : 'สแกนจ่าย / โอนเงิน';
    const ok = await R.confirmBox('ยืนยันสั่งข้าวใช่ไหมคะ', 'ยอด ฿' + money(o.total) + ' จ่ายโดย ' + payText, 'ใช่ ยืนยันสั่งซื้อ', 'ยังก่อน', 'go');
    if (!ok) return;
    R.busy(true, 'กำลังยืนยัน...');
    try {
      const u = await R.api('confirmOrder', { orderId: id, payMethod: pay });
      upsertOrder(u);
      R.sendChat('ยืนยันสั่งซื้อ #' + id + ' ยอด ฿' + money(u.total) + ' (' + payText + ')');
      R.toast('ยืนยันสั่งข้าวแล้ว', 'ok');
      render();
      window.scrollTo(0, 0);
    } catch (e) { R.toast(e.message, 'err'); } finally { R.busy(false); }
  }

  async function uploadSlip(input) {
    const file = input.files && input.files[0];
    const id = input.dataset.id;
    input.value = '';
    if (!file) return;
    let dataUrl;
    try { dataUrl = await R.resizeImage(file, 1400, 0.82); } catch (e) { R.toast(e.message, 'err'); return; }
    const ok = await R.modal({
      title: 'ส่งรูปสลิปนี้ใช่ไหมคะ',
      html: '<img src="' + dataUrl + '" alt="รูปสลิปที่เลือก" style="max-height:50vh;margin:0 auto;border-radius:10px;border:1px solid var(--line)">',
      actions: [{ label: 'ใช่ ส่งรูปนี้', value: true, kind: 'go' }, { label: 'เลือกรูปใหม่', value: false, kind: 'ghost' }],
    });
    if (!ok) return;
    R.busy(true, 'กำลังส่งรูปสลิป...');
    try {
      const u = await R.api('uploadSlip', { orderId: id, image: dataUrl, mime: 'image/jpeg' });
      upsertOrder(u);
      R.sendChat('ส่งสลิปโอนเงินแล้ว #' + id);
      R.toast('ส่งรูปสลิปแล้ว ร้านกำลังตรวจสอบ', 'ok');
      render();
      window.scrollTo(0, 0);
    } catch (e) { R.toast(e.message, 'err'); } finally { R.busy(false); }
  }

  async function cancelOrder(id) {
    const ok = await R.confirmBox('ยกเลิกการสั่งข้าวนี้ใช่ไหมคะ', 'ถ้ายกเลิกแล้ว ต้องสั่งใหม่อีกครั้ง', 'ใช่ ยกเลิก', 'ไม่ยกเลิก', 'danger');
    if (!ok) return;
    R.busy(true, 'กำลังยกเลิก...');
    try {
      upsertOrder(await R.api('cancelOrder', { orderId: id }));
      R.toast('ยกเลิกการสั่งข้าวแล้ว', 'ok');
      render();
    } catch (e) { R.toast(e.message, 'err'); } finally { R.busy(false); }
  }

  function reorder(id) {
    const o = S.orders.find((x) => x.orderId === id);
    if (!o) return;
    cart = newCart();
    o.items.forEach((i) => { if (productById(i.productId)) cart.items[i.productId] = i.qty; });
    if (!cartLines().length) { R.toast('ข้าวที่เคยสั่งปิดขายแล้ว กรุณาเลือกใหม่', 'err'); saveCart(); go('#/shop'); return; }
    Object.assign(cart, { purpose: o.purpose, purposeNote: o.purposeNote || '', deliveryMethod: o.deliveryMethod, address: o.address || '', lat: o.lat, lng: o.lng });
    saveCart();
    R.toast('ใส่รายการเดิมให้แล้ว ตรวจสอบแล้วกดส่งได้เลย', 'ok');
    go('#/review');
  }

  /* ---------- ข้อมูลของฉัน / ลงทะเบียน ---------- */

  function profileView(isNew) {
    if (!pf) {
      const c = S.customer || {};
      pf = { fullName: c.fullName || S.user.name || '', phone: c.phone || '', address: c.address || '', lat: c.lat || null, lng: c.lng || null, purpose: c.purpose || '', purposeNote: c.purposeNote || '' };
    }
    const tiles = R.PURPOSES.map((p) => tile({ act: 'pf-purpose', id: p.id, icon: p.icon, label: p.label, sub: '', on: pf.purpose === p.id, wide: p.id === 'other' })).join('');
    return {
      back: isNew ? '' : '#/', top: isNew ? shopName() : 'ข้อมูลของฉัน',
      body:
        '<h1 class="page-title">' + (isNew ? 'ยินดีต้อนรับ' : 'ข้อมูลของฉัน') + '</h1>' +
        '<p class="page-lead" style="margin-bottom:1.1rem">' + (isNew ? 'กรอกข้อมูลผู้สั่งครั้งเดียว ครั้งต่อไปไม่ต้องกรอกอีก (ใช้เวลาประมาณ 1 นาที)' : 'แก้ไขแล้วกดบันทึก') + '</p>' +
        '<div class="panel">' +
        '<label class="field"><span class="field-label">ชื่อ-นามสกุล</span><input class="input" id="pf-fullName" data-bind="pf.fullName" value="' + esc(pf.fullName) + '" autocomplete="name" maxlength="100"></label>' +
        '<label class="field"><span class="field-label">เบอร์โทรศัพท์</span><input class="input" id="pf-phone" data-bind="pf.phone" value="' + esc(pf.phone) + '" type="tel" inputmode="numeric" autocomplete="tel" maxlength="12" placeholder="08x-xxx-xxxx">' +
        '<span class="field-hint">ร้านจะโทรหาเบอร์นี้ตอนไปส่งข้าว</span></label>' +
        '<label class="field"><span class="field-label">ที่อยู่สำหรับส่งข้าว</span><textarea class="textarea" data-bind="pf.address" rows="3" maxlength="500" placeholder="บ้านเลขที่ หมู่ ซอย ถนน ตำบล">' + esc(pf.address) + '</textarea>' +
        '<span class="field-hint">ถ้ามารับเองที่ร้าน ไม่ต้องกรอกก็ได้</span></label>' +
        locBlock('pf', pf.lat, pf.lng) +
        '</div>' +
        '<p class="privacy">' + icon('check') + '<span>ร้านใช้ข้อมูลนี้เพื่อจัดส่งข้าวและโทรติดต่อคุณเท่านั้น ไม่ส่งต่อให้ผู้อื่น</span></p>' +
        '<section class="section"><h2 class="section-title">ปกติซื้อข้าวไปใช้ทำอะไร</h2><div class="tiles">' + tiles + '</div></section>',
      bar: '<button type="button" class="btn btn-primary btn-lg btn-block" data-act="save-profile" data-id="' + (isNew ? 'new' : '') + '">' +
        icon('check') + (isNew ? ' บันทึก แล้วเริ่มสั่งข้าว' : ' บันทึกข้อมูล') + '</button>',
    };
  }
  VIEWS.register = () => profileView(true);
  VIEWS.profile = () => profileView(false);

  async function saveProfile(isNew) {
    const errs = [];
    const phone = String(pf.phone || '').replace(/\D/g, '');
    if (String(pf.fullName || '').trim().length < 2) errs.push(['pf-fullName', 'กรุณากรอกชื่อ']);
    if (!/^0\d{8,9}$/.test(phone)) errs.push(['pf-phone', 'กรุณากรอกเบอร์โทร 10 หลัก เช่น 0812345678']);
    document.querySelectorAll('.field-error').forEach((e) => e.remove());
    document.querySelectorAll('.is-invalid').forEach((e) => e.classList.remove('is-invalid'));
    if (errs.length) {
      errs.forEach(([id, msg]) => {
        const el = document.getElementById(id);
        el.classList.add('is-invalid'); el.setAttribute('aria-invalid', 'true');
        el.insertAdjacentHTML('afterend', '<span class="field-error">' + msg + '</span>');
      });
      document.getElementById(errs[0][0]).focus();
      R.toast(errs[0][1], 'err');
      return;
    }
    R.busy(true, 'กำลังบันทึก...');
    try {
      S.customer = await R.api('saveProfile', { profile: Object.assign({}, pf, { phone, purpose: pf.purpose || 'home' }) });
      pf = null;
      R.toast('บันทึกข้อมูลแล้ว', 'ok');
      go(isNew ? '#/shop' : cartLines().length && cart.deliveryMethod ? '#/review' : '#/');
    } catch (e) { R.toast(e.message, 'err'); } finally { R.busy(false); }
  }

  /* =========================================================
   * Events
   * ========================================================= */

  app.addEventListener('keydown', (e) => {
    const card = e.target.closest && e.target.closest('.prod.is-closed');
    if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); card.click(); }
  });

  app.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const act = el.dataset.act, id = el.dataset.id;
    switch (act) {
      case 'go': go(el.dataset.to); break;
      case 'shop-exit': {
        const n = cartLines().length;
        if (n && !(await R.confirmBox('ออกจากหน้าสั่งซื้อ?', 'ข้าวที่เลือกไว้ ' + n + ' รายการ จะถูกยกเลิก', 'ออกและไม่บันทึกรายการ', 'ดำเนินการต่อ'))) break;
        go('#/');
        break;
      }
      case 'size': openSizeSheet(); break;
      case 'fsheet': openFilterSheet(el.dataset.k); break;
      case 'variant': {
        const v = productById(id);
        if (v) { VSEL[gkey(v)] = id; const card = redrawCard(id); const b = card && card.querySelector('.vchip[data-id="' + CSS.escape(id) + '"]'); if (b) b.focus({ preventScroll: true }); }
        break;
      }
      case 'funset': F[el.dataset.k] = ''; refreshShop(); break;
      case 'filter-clear': {
        F.q = ''; F.cat = ''; F.unit = ''; F.size = '';
        const q = document.getElementById('shop-q');
        if (q) q.value = '';
        refreshShop();
        break;
      }
      case 'pick': {
        const v = productById(id);
        if (!v) break;
        OPEN.add(gkey(v));
        const card = redrawCard(id);
        const first = card && card.querySelector('.vchip, [data-act="inc"]');
        if (card) card.classList.add('just-open');
        if (first) first.focus({ preventScroll: true });
        break;
      }
      case 'unpick': {
        const v = productById(id);
        if (!v) break;
        OPEN.delete(gkey(v)); delete VSEL[gkey(v)];
        const card = redrawCard(id);
        const b = card && card.closest('[data-act="pick"]') || card;
        if (b) b.focus({ preventScroll: true });
        break;
      }
      case 'inc': setQty(id, (cart.items[id] || 0) + 1); break;
      case 'dec': setQty(id, (cart.items[id] || 0) - 1); break;
      case 'qty': askQty(id); break;
      case 'purpose':
        if (cart.purpose !== id) cart.purposeNote = '';
        cart.purpose = id; saveCart(); render(); break;
      case 'purpose-next': {
        const p = R.purposeOf(cart.purpose);
        if (p.noteRequired && !String(cart.purposeNote || '').trim()) {
          R.toast('กรุณาบอกร้านว่าซื้อข้าวไปใช้ทำอะไร', 'err');
          const inp = document.querySelector('[data-bind="purposeNote"]'); if (inp) inp.focus();
          return;
        }
        go('#/delivery'); break;
      }
      case 'method': cart.deliveryMethod = id; saveCart(); render(); break;
      case 'want': cart.wantMode = id; saveCart(); render(); break;
      case 'delivery-next':
        if (cart.deliveryMethod === 'delivery' && String(cart.address || '').trim().length < 5 && !cart.lat) {
          R.toast('กรุณาบอกที่อยู่ หรือกดปุ่ม "ใช้ตำแหน่งที่อยู่ตอนนี้"', 'err');
          const t = document.querySelector('[data-bind="address"]'); if (t) t.focus();
          return;
        }
        if (cart.wantMode === 'date' && !cart.wantDate) { R.toast('กรุณาเลือกวันที่ต้องการรับข้าว', 'err'); return; }
        if (cart.wantMode === 'date') {
          const d = new Date(cart.wantDate + 'T12:00:00');
          const min = new Date(); if (closedNow()) min.setDate(min.getDate() + 1);
          if (ymd(d) < ymd(min)) { R.toast(closedNow() ? 'ตอนนี้ร้านปิดอยู่ กรุณาเลือกตั้งแต่พรุ่งนี้' : 'กรุณาเลือกวันนี้หรือวันถัดไป', 'err'); return; }
          if (!openOn(d)) { R.toast('ร้านหยุดวันที่เลือก กรุณาเลือกวันอื่น', 'err'); return; }
        }
        normalizeWant();
        go('#/review'); break;
      case 'locate': {
        el.disabled = true;
        const old = el.innerHTML;
        el.innerHTML = '<span class="spinner" style="width:1.2rem;height:1.2rem;border-width:2px"></span> กำลังหาตำแหน่ง...';
        try {
          const ll = await R.getLocation();
          const target = id === 'pf' ? pf : cart;
          target.lat = ll.lat; target.lng = ll.lng;
          if (id !== 'pf') saveCart();
          document.getElementById('loc-status').innerHTML = locStatus(ll.lat, ll.lng, id);
          R.toast('ได้ตำแหน่งแล้ว', 'ok');
        } catch (err) { R.toast(err.message, 'err'); }
        el.disabled = false; el.innerHTML = old;
        break;
      }
      case 'unlocate': {
        const target = id === 'pf' ? pf : cart;
        target.lat = null; target.lng = null;
        if (id !== 'pf') saveCart();
        document.getElementById('loc-status').innerHTML = locStatus(null, null, id);
        break;
      }
      case 'submit': submitOrder(); break;
      case 'close': R.closeWindow(); break;
      case 'pay': payChoice[route().arg] = id; render(); break;
      case 'confirm': confirmOrder(id); break;
      case 'cancel': cancelOrder(id); break;
      case 'reorder': reorder(id); break;
      case 'pf-purpose':
        pf.purpose = id;
        document.querySelectorAll('[data-act="pf-purpose"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
        break;
      case 'save-profile': saveProfile(id === 'new'); break;
      case 'demo-reset':
        if (await R.confirmBox('ล้างข้อมูลทดลอง?', 'ข้าวที่สั่งและข้อมูลทดลองในเครื่องนี้จะถูกลบ', 'ล้างข้อมูล', 'ยกเลิก', 'danger')) {
          window.DemoServer.reset(); R.storage(CART_KEY, null); location.hash = ''; location.reload();
        }
        break;
    }
  });

  app.addEventListener('input', (e) => {
    if (e.target.id === 'shop-q') { F.q = e.target.value; refreshShop(); return; }
    const b = e.target.dataset && e.target.dataset.bind;
    if (!b) return;
    if (b.indexOf('pf.') === 0) { pf[b.slice(3)] = e.target.value; return; }
    cart[b] = e.target.value;
    saveCart();
  });

  app.addEventListener('change', (e) => {
    if (e.target.dataset && e.target.dataset.rerender) { render(); return; }
    if (e.target.dataset && e.target.dataset.file === 'slip') uploadSlip(e.target);
  });

  /* ---------- อัปเดตสถานะจากร้าน (เมื่อกลับมาที่หน้านี้) ---------- */

  async function refresh(force) {
    if (!force && Date.now() - S.fetchedAt < 15000) return;
    try {
      const before = JSON.stringify(S.orders.map((o) => o.orderId + o.status + o.total));
      const data = await R.api('bootstrap');
      S.orders = data.orders; S.settings = data.settings; S.products = data.products; S.fetchedAt = Date.now();
      if (JSON.stringify(S.orders.map((o) => o.orderId + o.status + o.total)) !== before && !document.querySelector('.modal-wrap')) render();
    } catch (e) { /* เงียบไว้ ลองใหม่ครั้งหน้า */ }
  }
  function maybeRefresh(r) {
    if (['home', 'orders', 'order'].indexOf(r.name) >= 0) refresh(false);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.loaded) refresh(true); });

  /* ---------- เริ่มต้น ---------- */

  function splash(text) {
    return '<div class="splash"><div>' + R.sackLoader('8.5rem') + '<h1 class="loading-text">' + esc(text) + '</h1>' +
      '<p class="splash-brand"><img src="assets/logo-96.png" alt="" width="40" height="40">' + esc(shopName()) + '</p></div></div>';
  }

  async function boot() {
    R.injectIcons();
    app.innerHTML = splash('กำลังเข้าสู่ระบบสั่งซื้อ...');
    try {
      await R.initAuth(R.CFG.LIFF_ID);
      const data = await R.api('bootstrap');
      Object.assign(S, data, { loaded: true, fetchedAt: Date.now() });
      if (data.settings && data.settings.SHOP_NAME) document.title = 'สั่งข้าว — ' + data.settings.SHOP_NAME;
      Object.keys(cart.items).forEach((id) => { if (!productById(id)) delete cart.items[id]; });
      saveCart();
      const q = new URLSearchParams(location.search).get('order');
      if (q) history.replaceState(null, '', location.pathname + '#/order/' + encodeURIComponent(q));
      render();
    } catch (e) {
      app.innerHTML = '<div class="splash"><div><svg class="ic" style="width:3rem;height:3rem;color:var(--red)"><use href="#i-alert"/></svg>' +
        '<h1 style="margin:.6rem 0">เปิดหน้าสั่งข้าวไม่สำเร็จ</h1><p class="muted">' + esc(e.message) + '</p>' +
        '<button type="button" class="btn btn-primary btn-lg" style="margin-top:1.2rem" onclick="location.reload()">ลองใหม่อีกครั้ง</button></div></div>';
    }
  }

  boot();
})();
