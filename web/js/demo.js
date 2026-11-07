/* demo.js — เซิร์ฟเวอร์จำลองสำหรับ "โหมดทดลอง"
 * ทำงานเหมือน Apps Script แต่เก็บข้อมูลใน localStorage ของเครื่องนี้
 * เปิดหน้าลูกค้าสั่งข้าว → เปิดหน้าแอดมินแจ้งราคา → กลับมาหน้าลูกค้ายืนยัน ได้ครบทั้ง flow
 */
(function () {
  'use strict';
  const KEY = 'rice_demo_db_v2';
  const ME = { userId: 'Udemo-me', name: 'สมศรี ใจดี', picture: '' };

  const PURPOSE_LABEL = { home: 'กินเองที่บ้าน', donate: 'ทำบุญ / บริจาค', restaurant: 'ร้านอาหาร', wholesale: 'ขายส่ง / ขายต่อ', other: 'อื่น ๆ' };
  const TRANS = {
    new: ['cancelled'], quoted: ['confirmed', 'cancelled'], confirmed: ['paid', 'shipping', 'cancelled'],
    slip: ['paid', 'confirmed', 'cancelled'], paid: ['shipping', 'done', 'cancelled'], shipping: ['done', 'cancelled'],
  };

  /* สินค้าตัวอย่างสำหรับโหมดทดลองเท่านั้น — ระบบจริงดึงข้าวจาก ZORT */
  const PRODUCTS = [
    ['p01', 'ข้าวตัวอย่าง A', 'ตัวอย่าง (ระบบจริงดึงจาก ZORT)', 5, 'ถุง', 200, 180, 'ข้าวหอมมะลิ'],
    ['p02', 'ข้าวตัวอย่าง B', 'ตัวอย่าง (ระบบจริงดึงจาก ZORT)', 5, 'ถุง', 220, 200, 'ข้าวหอมมะลิ'],
    ['p03', 'ข้าวตัวอย่าง C', 'ตัวอย่าง (ระบบจริงดึงจาก ZORT)', 15, 'กระสอบ', 600, 560, 'ข้าวหอมมะลิ'],
    ['p04', 'ข้าวตัวอย่าง D', 'ตัวอย่าง (ระบบจริงดึงจาก ZORT)', 1, 'ถุง', 45, 40, 'ข้าวเหนียว'],
    ['p05', 'ข้าวตัวอย่าง E', 'ตัวอย่าง (ระบบจริงดึงจาก ZORT)', 5, 'ถุง', 150, 135, 'ข้าวขาว'],
    ['p06', 'ข้าวตัวอย่าง F', 'ตัวอย่าง (ระบบจริงดึงจาก ZORT)', 49, 'กระสอบ', 1250, 1180, 'ข้าวขาว'],
  ].map((r, i) => ({
    id: r[0], name: r[1], detail: r[2], sizeKg: r[3], unit: r[4], price: r[5], priceWholesale: r[6], category: r[7],
    image: '', active: true, sort: i + 1,
  }));

  const SETTINGS = {
    SHOP_NAME: 'หจก.บุญมีหาดใหญ่', LOGO_URL: 'assets/logo.png', SHOP_PHONE: '086-961-3331, 074-244-690', SHOP_ADDRESS: '51 ถนนเชื่อมรัฐ ตำบลหาดใหญ่ อำเภอหาดใหญ่ สงขลา 90110',
    SHOP_HOURS: 'วันจันทร์–วันเสาร์ 8.00–17.00 น.', SHOP_LAT: 7.0086, SHOP_LNG: 100.4747, SHOP_TAX_ID: '0-9035-xxxxx-xx-x (ตัวอย่าง)',
    QUOTE_TIME: 'ภายใน 1 ชั่วโมงในเวลาทำการ', PROMPTPAY_ID: '0812345678', PROMPTPAY_NAME: 'หจก.บุญมีหาดใหญ่ (ตัวอย่าง)',
    BANK_INFO: 'หรือโอนเข้า ธ.กสิกรไทย 012-3-45678-9 (บัญชีตัวอย่าง)', ALLOW_COD: 'TRUE',
    SHIP_BASE: 30, SHIP_PER_KM: 5, FREE_SHIP_BAGS: 10, ADMIN_NOTIFY: 'TRUE',
  };

  function iso(minAgo) { return new Date(Date.now() - minAgo * 60000).toISOString(); }

  function seed() {
    const mk = (id, min, cust, purpose, note, items, method, extra) => {
      const its = items.map(([pid, qty]) => {
        const p = PRODUCTS.find((x) => x.id === pid);
        const ws = purpose === 'restaurant' || purpose === 'wholesale';
        return { productId: p.id, name: p.name, detail: p.detail, sizeKg: p.sizeKg, unit: p.unit, image: p.image, qty, refPrice: ws ? p.priceWholesale : p.price };
      });
      return Object.assign({
        orderId: id, createdAt: iso(min), updatedAt: iso(min), status: 'new',
        userId: cust.userId, lineName: cust.lineName, fullName: cust.fullName, phone: cust.phone,
        purpose, purposeLabel: PURPOSE_LABEL[purpose], purposeNote: note,
        deliveryMethod: method, address: method === 'delivery' ? cust.address : '', lat: cust.lat, lng: cust.lng,
        distanceKm: method === 'delivery' ? cust.km : null, wantDate: 'เร็วที่สุด', note: '',
        items: its, itemsText: its.map((i) => i.name + ' ' + i.sizeKg + ' กก. × ' + i.qty + ' ' + i.unit).join('\n'),
        totalBags: its.reduce((s, i) => s + i.qty, 0), totalKg: its.reduce((s, i) => s + i.qty * i.sizeKg, 0),
        quote: null, total: 0, payMethod: '', slipUrl: '', cancelReason: '',
        history: [{ at: iso(min), by: 'customer', status: 'new', note: '' }],
        customer: { linePicture: '', orderCount: 3 },
      }, extra || {});
    };
    const c1 = { userId: 'Udemo-a', lineName: 'ป้าแดง', fullName: 'แดง ศรีสุข', phone: '0891112233', address: 'วัดโคกนาว ต.คอหงส์ อ.หาดใหญ่', lat: 7.0215, lng: 100.4995, km: 3.1 };
    const c2 = { userId: 'Udemo-b', lineName: 'ร้านข้าวแกงนายหมู', fullName: 'สมชาย ข้าวแกง', phone: '0869998877', address: '55 ถ.ศรีภูวนารถ หาดใหญ่', lat: 7.0045, lng: 100.4689, km: 0.8 };
    const c3 = { userId: 'Udemo-c', lineName: 'ลุงเย็น', fullName: 'เย็น ใจกว้าง', phone: '0812223344', address: '', lat: null, lng: null, km: null };
    const q = (lines, ship) => {
      const sub = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
      return { lines: lines.map((l) => Object.assign({ amount: l.qty * l.unitPrice }, l)), subtotal: sub, shippingFee: ship, discount: 0, total: sub + ship, note: '' };
    };
    const quote2 = q([{ productId: 'p02', name: 'ข้าวตัวอย่าง B', sizeKg: 5, unit: 'ถุง', qty: 20, unitPrice: 200 }], 0);
    const quote3 = q([{ productId: 'p03', name: 'ข้าวตัวอย่าง C', sizeKg: 15, unit: 'กระสอบ', qty: 2, unitPrice: 600 }], 0);
    return {
      customers: {},
      orders: [
        mk('R000000-901', 12, c1, 'donate', 'ถวายวัดโคกนาว งานกฐิน', [['p01', 10], ['p02', 5]], 'delivery'),
        mk('R000000-902', 95, c2, 'restaurant', 'ร้านข้าวแกงนายหมู', [['p02', 20]], 'delivery',
          { status: 'slip', quote: quote2, total: quote2.total, payMethod: 'transfer', slipUrl: '#demo-slip', quotedAt: iso(80), confirmedAt: iso(60), slipAt: iso(40) }),
        mk('R000000-903', 60 * 26, c3, 'home', '', [['p03', 2]], 'pickup',
          { status: 'done', quote: quote3, total: quote3.total, payMethod: 'cod', quotedAt: iso(60 * 25), confirmedAt: iso(60 * 24), paidAt: iso(60 * 20), doneAt: iso(60 * 20) }),
      ],
      seq: 0,
    };
  }

  function load() {
    try { const db = JSON.parse(localStorage.getItem(KEY)); if (db && db.orders) return db; } catch (e) { /* ignore */ }
    const db = seed(); save(db); return db;
  }
  function save(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* ignore */ } }

  function err(code, msg) { const e = new Error(msg); e.code = code; throw e; }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function hist(o, by, note) { o.history.push({ at: new Date().toISOString(), by, status: o.status, note: note || '' }); o.updatedAt = new Date().toISOString(); }
  function findOwn(db, id) { const o = db.orders.find((x) => x.orderId === id); if (!o || o.userId !== ME.userId) err('not_found', 'ไม่พบคำสั่งซื้อนี้'); return o; }
  function dist(lat, lng) {
    if (!lat || !lng) return null;
    const R = 6371, r = Math.PI / 180, a = Math.sin((lat - SETTINGS.SHOP_LAT) * r / 2) ** 2 +
      Math.cos(lat * r) * Math.cos(SETTINGS.SHOP_LAT * r) * Math.sin((lng - SETTINGS.SHOP_LNG) * r / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(a)) * 10) / 10;
  }

  const H = {
    bootstrap(db) {
      return { user: ME, customer: db.customers[ME.userId] || null, products: PRODUCTS, settings: SETTINGS,
        orders: db.orders.filter((o) => o.userId === ME.userId), isAdmin: true };
    },
    saveProfile(db, { profile: p }) {
      const phone = String(p.phone || '').replace(/\D/g, '');
      if (String(p.fullName || '').trim().length < 2) err('invalid', 'กรุณากรอกชื่อ');
      if (!/^0\d{8,9}$/.test(phone)) err('invalid', 'เบอร์โทรต้องเป็นตัวเลข 9–10 หลัก ขึ้นต้นด้วย 0');
      const prev = db.customers[ME.userId] || { orderCount: 0 };
      db.customers[ME.userId] = Object.assign(prev, {
        userId: ME.userId, lineName: ME.name, fullName: String(p.fullName).trim(), phone,
        address: String(p.address || '').trim(), lat: p.lat || null, lng: p.lng || null,
        purpose: p.purpose || 'home', purposeNote: p.purposeNote || '',
      });
      return db.customers[ME.userId];
    },
    createOrder(db, { order: o }) {
      const c = db.customers[ME.userId];
      if (!c) err('need_profile', 'กรุณากรอกชื่อและเบอร์โทรก่อนสั่งซื้อ');
      if (!PURPOSE_LABEL[o.purpose]) err('invalid', 'กรุณาเลือกว่าซื้อข้าวไปใช้ทำอะไร');
      if (o.purpose === 'other' && !String(o.purposeNote || '').trim()) err('invalid', 'กรุณาบอกร้านว่าซื้อข้าวไปใช้ทำอะไร');
      const ws = o.purpose === 'restaurant' || o.purpose === 'wholesale';
      const items = (o.items || []).map((it) => {
        const p = PRODUCTS.find((x) => x.id === it.productId);
        if (!p) err('invalid', 'มีข้าวบางรายการปิดขายแล้ว');
        return { productId: p.id, name: p.name, detail: p.detail, sizeKg: p.sizeKg, unit: p.unit, image: p.image, qty: Math.floor(it.qty), refPrice: ws ? p.priceWholesale : p.price };
      }).filter((i) => i.qty > 0);
      if (!items.length) err('invalid', 'กรุณาเลือกข้าวอย่างน้อย 1 รายการ');
      const del = o.deliveryMethod !== 'pickup';
      if (del && String(o.address || '').trim().length < 5 && !o.lat) err('invalid', 'กรุณาบอกที่อยู่จัดส่ง หรือกดปุ่ม "ใช้ตำแหน่งที่อยู่ตอนนี้"');
      db.seq += 1;
      const d = new Date(), ymd = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
      const now = d.toISOString();
      const order = {
        orderId: 'R' + ymd + '-' + String(db.seq).padStart(3, '0'), createdAt: now, updatedAt: now, status: 'new',
        userId: ME.userId, lineName: ME.name, fullName: c.fullName, phone: c.phone,
        purpose: o.purpose, purposeLabel: PURPOSE_LABEL[o.purpose], purposeNote: String(o.purposeNote || '').trim(),
        deliveryMethod: del ? 'delivery' : 'pickup', address: del ? String(o.address || '').trim() : '',
        lat: del ? o.lat || null : null, lng: del ? o.lng || null : null, distanceKm: del ? dist(o.lat, o.lng) : null,
        wantDate: o.wantDate || '', note: String(o.note || '').trim(), items,
        itemsText: items.map((i) => i.name + ' ' + i.sizeKg + ' กก. × ' + i.qty + ' ' + i.unit).join('\n'),
        totalBags: items.reduce((s, i) => s + i.qty, 0), totalKg: items.reduce((s, i) => s + i.qty * i.sizeKg, 0),
        quote: null, total: 0, payMethod: '', slipUrl: '', cancelReason: '',
        history: [{ at: now, by: 'customer', status: 'new', note: '' }], customer: { linePicture: '', orderCount: (c.orderCount || 0) + 1 },
      };
      db.orders.unshift(order);
      c.orderCount = (c.orderCount || 0) + 1; c.purpose = o.purpose; c.purposeNote = order.purposeNote;
      return order;
    },
    getOrder(db, { orderId }) { return findOwn(db, orderId); },
    confirmOrder(db, { orderId, payMethod }) {
      const o = findOwn(db, orderId);
      if (o.status !== 'quoted') err('bad_status', 'คำสั่งซื้อนี้ยืนยันไปแล้ว');
      if (['transfer', 'cod'].indexOf(payMethod) < 0) err('invalid', 'กรุณาเลือกวิธีจ่ายเงิน');
      o.status = 'confirmed'; o.payMethod = payMethod; o.confirmedAt = new Date().toISOString();
      hist(o, 'customer', payMethod === 'cod' ? 'จ่ายเงินสดตอนรับข้าว' : 'โอนเงิน / สแกนจ่าย');
      return o;
    },
    uploadSlip(db, { orderId, image }) {
      const o = findOwn(db, orderId);
      if (['confirmed', 'slip'].indexOf(o.status) < 0) err('bad_status', 'ส่งสลิปไม่ได้ในตอนนี้');
      if (!image) err('invalid', 'ไม่พบรูปสลิป');
      o.status = 'slip'; o.payMethod = 'transfer'; o.slipUrl = '#demo-slip'; o.slipAt = new Date().toISOString();
      hist(o, 'customer', 'ส่งรูปสลิปโอนเงิน');
      return o;
    },
    cancelOrder(db, { orderId }) {
      const o = findOwn(db, orderId);
      if (['new', 'quoted', 'confirmed'].indexOf(o.status) < 0) err('bad_status', 'ยกเลิกเองไม่ได้แล้ว กรุณาโทรหาร้าน');
      o.status = 'cancelled'; o.cancelReason = 'ลูกค้ายกเลิกเอง'; hist(o, 'customer', 'ลูกค้ายกเลิกเอง');
      return o;
    },
    adminClaim() { return { ok: true }; },
    adminBootstrap(db) {
      return { admin: { userId: ME.userId, name: 'แอดมิน (ทดลอง)' }, orders: db.orders, products: PRODUCTS, settings: SETTINGS, sheetUrl: '', serverTime: new Date().toISOString() };
    },
    adminZortSync() { err('demo', 'โหมดทดลองเชื่อม ZORT ไม่ได้ — ต้องตั้งค่า Apps Script ก่อน'); },
    adminQuote(db, req) {
      const o = db.orders.find((x) => x.orderId === req.orderId) || err('not_found', 'ไม่พบคำสั่งซื้อ');
      if (['new', 'quoted', 'confirmed'].indexOf(o.status) < 0) err('bad_status', 'ส่งราคาไม่ได้ในสถานะนี้');
      const lines = (req.lines || []).map((l) => ({
        productId: l.productId, name: l.name, sizeKg: l.sizeKg, unit: l.unit,
        qty: Math.max(0, Math.floor(Number(l.qty) || 0)), unitPrice: Math.max(0, Number(l.unitPrice) || 0),
      })).filter((l) => l.qty > 0).map((l) => Object.assign(l, { amount: Math.round(l.qty * l.unitPrice * 100) / 100 }));
      if (!lines.length) err('invalid', 'ต้องมีสินค้าอย่างน้อย 1 รายการ');
      const subtotal = lines.reduce((s, l) => s + l.amount, 0);
      const shippingFee = Math.max(0, Number(req.shippingFee) || 0), discount = Math.max(0, Number(req.discount) || 0);
      const total = Math.max(0, subtotal + shippingFee - discount);
      if (total <= 0) err('invalid', 'ยอดรวมต้องมากกว่า 0 บาท');
      o.quote = { lines, subtotal, shippingFee, discount, total, note: String(req.note || '').trim(), by: 'แอดมิน', at: new Date().toISOString() };
      o.total = total; o.status = 'quoted'; o.quotedAt = new Date().toISOString(); o.payMethod = '';
      hist(o, 'admin:แอดมิน', 'แจ้งราคา ฿' + total.toLocaleString());
      return { order: o, pushed: false, pushError: 'โหมดทดลอง: ไม่ได้ส่ง LINE จริง' };
    },
    adminSetStatus(db, req) {
      const o = db.orders.find((x) => x.orderId === req.orderId) || err('not_found', 'ไม่พบคำสั่งซื้อ');
      if ((TRANS[o.status] || []).indexOf(req.status) < 0) err('bad_status', 'เปลี่ยนสถานะนี้ไม่ได้');
      if (o.status === 'confirmed' && req.status === 'shipping' && o.payMethod !== 'cod') err('bad_status', 'ลูกค้าเลือกโอนเงิน กรุณากด "ได้รับเงินแล้ว" ก่อน');
      const now = new Date().toISOString();
      if (req.status === 'confirmed' && req.payMethod) o.payMethod = req.payMethod;
      if (req.status === 'paid') o.paidAt = now;
      if (req.status === 'shipping') o.shippedAt = now;
      if (req.status === 'done') { o.doneAt = now; o.paidAt = o.paidAt || now; }
      if (req.status === 'cancelled') o.cancelReason = req.note || 'ร้านยกเลิก';
      o.status = req.status;
      hist(o, 'admin:แอดมิน', req.note || '');
      return { order: o, pushed: false, pushError: req.notify === false ? '' : 'โหมดทดลอง: ไม่ได้ส่ง LINE จริง' };
    },
  };

  window.DemoServer = {
    user: ME,
    reset() { localStorage.removeItem(KEY); },
    async handle(action, payload) {
      await new Promise((r) => setTimeout(r, 260));
      const fn = H[action];
      if (!fn) err('bad_action', 'ไม่รู้จักคำสั่ง ' + action);
      const db = load();
      try {
        const out = fn(db, payload);
        save(db);
        return clone(out);
      } catch (e) {
        const er = new window.Rice.ApiError(e.code || 'error', e.message);
        throw er;
      }
    },
  };
})();
