/**
 * ระบบสั่งข้าวสารผ่าน LINE OA — Backend (Google Apps Script Web App)
 *
 * Code.gs — จุดรับคำขอทั้งหมด
 *   - หน้าเว็บ (LIFF) เรียก API ด้วย POST {action, idToken, ...}
 *   - LINE Messaging API ส่ง webhook มาที่ URL เดียวกัน (มี field "events")
 *
 * Script Properties ที่ต้องตั้ง (Project Settings → Script properties):
 *   LINE_CHANNEL_ACCESS_TOKEN  — จาก Messaging API channel (long-lived)
 *   LOGIN_CHANNEL_ID           — Channel ID ของ LINE Login channel ที่สร้าง LIFF
 *   LIFF_ID                    — LIFF ID หน้าลูกค้า (ใช้สร้างลิงก์ในข้อความ LINE)
 *   ADMIN_URL                  — (ไม่บังคับ) ลิงก์หน้าแอดมิน เช่น https://liff.line.me/<ADMIN_LIFF_ID>
 *   ADMIN_SETUP_CODE           — setup() สร้างให้อัตโนมัติ ใช้ลงทะเบียนแอดมินครั้งแรก
 *   ZORT_STORENAME / ZORT_APIKEY / ZORT_APISECRET — (ไม่บังคับ) เชื่อมสินค้าจาก ZORT ดู Zort.gs
 */

const APP_VERSION = '1.0.0';

const PURPOSES = {
  home: 'ทั่วไป/ใช้ส่วนตัว',
  donate: 'สำหรับถวายพระ/ทำบุญ',
  restaurant: 'ร้านอาหาร',
  wholesale: 'ขายส่ง/ขายต่อ',
  other: 'อื่น ๆ',
};
/** วัตถุประสงค์ที่ระบบเสนอราคาส่งให้แอดมินเป็นค่าเริ่มต้น */
const WHOLESALE_PURPOSES = ['restaurant', 'wholesale'];

const STATUS_LABEL = {
  new: 'รอร้านแจ้งราคา',
  quoted: 'ร้านแจ้งราคาแล้ว รอยืนยัน',
  confirmed: 'ยืนยันแล้ว',
  slip: 'ส่งสลิปแล้ว รอร้านตรวจสอบ',
  paid: 'ชำระเงินแล้ว กำลังเตรียมข้าว',
  shipping: 'กำลังจัดส่ง',
  done: 'ได้รับข้าวแล้ว',
  cancelled: 'ยกเลิกแล้ว',
};

/** สถานะที่แอดมินเปลี่ยนไปได้ จากสถานะปัจจุบัน */
const ADMIN_TRANSITIONS = {
  new: ['cancelled'],
  quoted: ['confirmed', 'cancelled'],
  confirmed: ['paid', 'shipping', 'done', 'cancelled'],   // done: เฉพาะเงินสดตอนรับข้าว
  slip: ['paid', 'confirmed', 'cancelled'],
  paid: ['shipping', 'done', 'cancelled'],
  shipping: ['done', 'cancelled'],
  done: ['cancelled'],              // ยกเลิกการขายที่ปิดแล้ว (คืนเงิน/คืนสินค้า)
};

/* =========================================================
 * Entry points
 * ========================================================= */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'ping') return json_({ ok: true, version: APP_VERSION });
  return ContentService.createTextOutput('Rice Order API ' + APP_VERSION + ' พร้อมใช้งาน');
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, code: 'bad_json', error: 'ข้อมูลไม่ถูกต้อง' });
  }

  // LINE webhook
  if (Array.isArray(body.events)) {
    try { handleWebhook_(body); } catch (err) { console.error('webhook', err && err.stack || err); }
    return json_({ ok: true });
  }

  try {
    return json_({ ok: true, data: route_(body) });
  } catch (err) {
    if (!err.code) console.error(err && err.stack || err);
    return json_({ ok: false, code: err.code || 'error', error: String(err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function route_(req) {
  const action = String(req.action || '');
  const user = verifyUser_(req.idToken);

  switch (action) {
    case 'bootstrap': return apiBootstrap_(user);
    case 'saveProfile': return withLock_(function () { return apiSaveProfile_(user, req.profile || {}); });
    case 'createOrder': return withLock_(function () { return apiCreateOrder_(user, req.order || {}); });
    case 'getOrder': return orderView_(ownOrder_(user, req.orderId));
    case 'confirmOrder': return withLock_(function () { return apiConfirmOrder_(user, req.orderId, req.payMethod); });
    case 'uploadSlip': return apiUploadSlip_(user, req);
    case 'cancelOrder': return withLock_(function () { return apiCancelOrder_(user, req.orderId); });
    case 'adminClaim': return withLock_(function () { return apiAdminClaim_(user, req.code); });
  }

  const admin = requireAdmin_(user);
  switch (action) {
    case 'adminBootstrap': return apiAdminBootstrap_(admin);
    case 'adminQuote': return withLock_(function () { return apiAdminQuote_(admin, req); });
    case 'adminSetStatus': return withLock_(function () { return apiAdminSetStatus_(admin, req); });
    case 'adminZortSync': return apiAdminZortSync_();
    case 'adminZortPushOrder': return withLock_(function () { return apiAdminZortPushOrder_(req); });
    case 'adminZortVoidDone': return withLock_(function () { return apiAdminZortVoidDone_(admin, req); });
  }
  fail_('bad_action', 'ไม่รู้จักคำสั่ง ' + action);
}

/* =========================================================
 * ยืนยันตัวตนด้วย LIFF ID token
 * ========================================================= */

function verifyUser_(idToken) {
  if (!idToken) fail_('auth_required', 'กรุณาเข้าสู่ระบบ LINE');
  const cache = CacheService.getScriptCache();
  const key = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken)).slice(0, 43);
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const channelId = prop_('LOGIN_CHANNEL_ID');
  if (!channelId) fail_('config', 'ยังไม่ได้ตั้งค่า LOGIN_CHANNEL_ID ใน Script Properties');
  const res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post',
    payload: { id_token: idToken, client_id: channelId },
    muteHttpExceptions: true,
  });
  const data = parseJson_(res.getContentText(), {});
  if (res.getResponseCode() !== 200 || !data.sub) {
    fail_('auth_expired', 'การเข้าสู่ระบบหมดอายุ กรุณาเปิดหน้านี้ใหม่อีกครั้ง');
  }
  const user = { userId: data.sub, name: data.name || '', picture: data.picture || '' };
  const ttl = Math.max(60, Math.min(1800, (Number(data.exp) || 0) - Math.floor(Date.now() / 1000) - 30));
  cache.put(key, JSON.stringify(user), ttl);
  return user;
}

function isAdmin_(userId) {
  return admins_().some(function (a) { return a.userId === userId; });
}

function requireAdmin_(user) {
  const a = admins_().filter(function (x) { return x.userId === user.userId; })[0];
  if (!a) fail_('not_admin', 'บัญชี LINE นี้ยังไม่ได้เป็นแอดมิน');
  return { userId: user.userId, name: a.name || user.name || 'แอดมิน' };
}

/* =========================================================
 * Views
 * ========================================================= */

function customerView_(c) {
  if (!c) return null;
  return {
    userId: c.userId, lineName: c.lineName, linePicture: c.linePicture,
    fullName: String(c.fullName || ''), phone: String(c.phone || ''),
    address: String(c.address || ''), lat: num_(c.lat) || null, lng: num_(c.lng) || null,
    purpose: c.purpose || 'home', purposeNote: String(c.purposeNote || ''),
    orderCount: num_(c.orderCount),
  };
}

function orderView_(o) {
  return {
    orderId: o.orderId, createdAt: o.createdAt, updatedAt: o.updatedAt, status: o.status,
    userId: o.userId, lineName: o.lineName, fullName: String(o.fullName || ''), phone: String(o.phone || ''),
    purpose: o.purpose, purposeLabel: PURPOSES[o.purpose] || o.purpose, purposeNote: String(o.purposeNote || ''),
    deliveryMethod: o.deliveryMethod, address: String(o.address || ''),
    lat: num_(o.lat) || null, lng: num_(o.lng) || null, distanceKm: o.distanceKm === '' ? null : num_(o.distanceKm),
    wantDate: String(o.wantDate || ''), note: String(o.note || ''),
    items: parseJson_(o.itemsJson, []), itemsText: String(o.itemsText || ''),
    totalBags: num_(o.totalBags), totalKg: num_(o.totalKg),
    quote: parseJson_(o.quoteJson, null), total: num_(o.total),
    quotedAt: o.quotedAt || '', payMethod: o.payMethod || '', confirmedAt: o.confirmedAt || '',
    slipUrl: o.slipUrl || '', slipAt: o.slipAt || '', paidAt: o.paidAt || '',
    shippedAt: o.shippedAt || '', doneAt: o.doneAt || '', cancelReason: String(o.cancelReason || ''),
    history: parseJson_(o.historyJson, []),
    zortOrderId: String(o.zortOrderId || ''), zortSyncedAt: o.zortSyncedAt || '', zortError: String(o.zortError || ''),
    zortVoidStatus: String(o.zortVoidStatus || ''), zortVoidAt: o.zortVoidAt || '', zortVoidBy: String(o.zortVoidBy || ''),
  };
}

function getCustomer_(userId) { return findRow_('Customers', 'userId', userId); }
function getOrderRow_(orderId) { return orderId ? findRow_('Orders', 'orderId', String(orderId)) : null; }

function ownOrder_(user, orderId) {
  const o = getOrderRow_(orderId);
  if (!o || o.userId !== user.userId) fail_('not_found', 'ไม่พบคำสั่งซื้อนี้');
  return o;
}

function ordersOfUser_(userId) {
  return findRows_('Orders', 'userId', userId)
    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })
    .map(orderView_);
}

/** บันทึกการเปลี่ยนแปลงคำสั่งซื้อ พร้อมประวัติ */
function updateOrder_(row, patch, by, note) {
  const history = parseJson_(row.historyJson, []);
  history.push({ at: new Date().toISOString(), by: by, status: patch.status || row.status, note: note || '' });
  patch.historyJson = JSON.stringify(history.slice(-40));
  patch.updatedAt = new Date();
  return updateRow_('Orders', row._row, patch);
}

/* =========================================================
 * Customer API
 * ========================================================= */

function apiBootstrap_(user) {
  let c = getCustomer_(user.userId);
  if (c && (c.lineName !== user.name || c.linePicture !== user.picture)) {
    c = withLock_(function () { return updateRow_('Customers', c._row, { lineName: user.name, linePicture: user.picture }); });
  }
  return {
    user: user,
    customer: customerView_(c),
    products: getProducts_(true),
    settings: getSettings_(),
    orders: ordersOfUser_(user.userId).slice(0, 30),
    isAdmin: isAdmin_(user.userId),
  };
}

function validLatLng_(lat, lng) {
  lat = Number(lat); lng = Number(lng);
  if (!isFinite(lat) || !isFinite(lng) || !lat || !lng || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

function apiSaveProfile_(user, p) {
  const fullName = clean_(p.fullName, 100);
  const phone = String(p.phone || '').replace(/\D/g, '');
  if (fullName.length < 2) fail_('invalid', 'กรุณากรอกชื่อ');
  if (!/^0\d{8,9}$/.test(phone)) fail_('invalid', 'เบอร์โทรต้องเป็นตัวเลข 9–10 หลัก ขึ้นต้นด้วย 0');
  const ll = validLatLng_(p.lat, p.lng);
  const data = {
    userId: user.userId, lineName: user.name, linePicture: user.picture,
    fullName: fullName, phone: phone, address: clean_(p.address, 500),
    lat: ll ? ll.lat : '', lng: ll ? ll.lng : '',
    purpose: PURPOSES[p.purpose] ? p.purpose : 'home', purposeNote: clean_(p.purposeNote, 200),
    updatedAt: new Date(),
  };
  const existing = getCustomer_(user.userId);
  const saved = existing
    ? updateRow_('Customers', existing._row, data)
    : insertRow_('Customers', Object.assign({ createdAt: new Date(), orderCount: 0 }, data));
  return customerView_(saved);
}

function apiCreateOrder_(user, o) {
  const cust = getCustomer_(user.userId);
  if (!cust || !cust.phone) fail_('need_profile', 'กรุณากรอกชื่อและเบอร์โทรก่อนสั่งซื้อ');

  const purpose = PURPOSES[o.purpose] ? o.purpose : fail_('invalid', 'กรุณาเลือกว่าซื้อข้าวไปใช้ทำอะไร');
  const purposeNote = clean_(o.purposeNote, 200);
  if (purpose === 'other' && !purposeNote) fail_('invalid', 'กรุณาบอกร้านว่าซื้อข้าวไปใช้ทำอะไร');

  const byId = {};
  getProducts_(true).forEach(function (p) { byId[p.id] = p; });
  const merged = {};
  (Array.isArray(o.items) ? o.items : []).slice(0, 40).forEach(function (it) {
    const p = byId[String(it.productId)];
    if (!p) fail_('invalid', 'มีข้าวบางรายการปิดขายแล้ว กรุณาเลือกใหม่');
    const qty = Math.floor(Number(it.qty));
    if (!(qty >= 1 && qty <= 9999)) fail_('invalid', 'จำนวนไม่ถูกต้อง');
    merged[p.id] = (merged[p.id] || 0) + qty;
  });
  const wholesale = WHOLESALE_PURPOSES.indexOf(purpose) >= 0;
  const items = Object.keys(merged).map(function (id) {
    const p = byId[id];
    return {
      productId: p.id, name: p.name, detail: p.detail, sizeKg: p.sizeKg, unit: p.unit, image: p.image,
      qty: merged[id], refPrice: wholesale && p.priceWholesale > 0 ? p.priceWholesale : p.price,
    };
  });
  if (!items.length) fail_('invalid', 'กรุณาเลือกข้าวอย่างน้อย 1 รายการ');

  const method = o.deliveryMethod === 'pickup' ? 'pickup' : 'delivery';
  const address = clean_(o.address, 500);
  const ll = validLatLng_(o.lat, o.lng);
  if (method === 'delivery' && address.length < 5 && !ll) {
    fail_('invalid', 'กรุณาบอกที่อยู่จัดส่ง หรือกดปุ่ม "ใช้ตำแหน่งที่อยู่ตอนนี้"');
  }

  const settingsNow = getSettings_();
  const wantDate = clean_(o.wantDate, 40);
  if (/^(เร็วที่สุด|ตอนนี้)/.test(wantDate) && shopOpenNow_(settingsNow) === false) {
    fail_('shop_closed', 'ตอนนี้ร้านปิดอยู่ กรุณาเลือกรับข้าวพรุ่งนี้ หรือเลือกวันอื่น');
  }

  const waiting = findRows_('Orders', 'userId', user.userId).filter(function (x) { return x.status === 'new'; }).length;
  if (waiting >= 5) fail_('too_many', 'มีคำสั่งซื้อรอร้านแจ้งราคาอยู่ 5 รายการแล้ว กรุณารอร้านติดต่อกลับก่อน');

  const settings = settingsNow;
  const now = new Date();
  const orderId = nextOrderId_();
  const row = {
    orderId: orderId, createdAt: now, updatedAt: now, status: 'new',
    userId: user.userId, lineName: user.name, fullName: cust.fullName, phone: String(cust.phone),
    purpose: purpose, purposeNote: purposeNote,
    deliveryMethod: method, address: method === 'delivery' ? address : '',
    lat: method === 'delivery' && ll ? ll.lat : '', lng: method === 'delivery' && ll ? ll.lng : '',
    distanceKm: method === 'delivery' && ll ? distanceKm_(settings, ll.lat, ll.lng) : '',
    wantDate: wantDate, note: clean_(o.note, 500),
    itemsText: items.map(function (i) { return i.name + ' ' + i.sizeKg + ' กก. × ' + i.qty + ' ' + i.unit; }).join('\n'),
    totalBags: items.reduce(function (s, i) { return s + i.qty; }, 0),
    totalKg: items.reduce(function (s, i) { return s + i.qty * i.sizeKg; }, 0),
    itemsJson: JSON.stringify(items),
    historyJson: JSON.stringify([{ at: now.toISOString(), by: 'customer', status: 'new', note: '' }]),
  };
  insertRow_('Orders', row);

  const custPatch = { orderCount: num_(cust.orderCount) + 1, purpose: purpose, purposeNote: purposeNote, updatedAt: now };
  if (!cust.address && method === 'delivery' && address) custPatch.address = address;
  if (!cust.lat && method === 'delivery' && ll) { custPatch.lat = ll.lat; custPatch.lng = ll.lng; }
  updateRow_('Customers', cust._row, custPatch);

  const view = orderView_(row);
  view.createdAt = now.toISOString();
  view.updatedAt = now.toISOString();
  try { notifyAdmins_([flexAdminNewOrder_(view, settings)]); } catch (err) { console.error(err); }
  return view;
}

function apiConfirmOrder_(user, orderId, payMethod) {
  const o = ownOrder_(user, orderId);
  if (o.status !== 'quoted') fail_('bad_status', 'ยืนยันไม่ได้ เพราะคำสั่งซื้อนี้ "' + STATUS_LABEL[o.status] + '"');
  const settings = getSettings_();
  if (['transfer', 'cod'].indexOf(payMethod) < 0) fail_('invalid', 'กรุณาเลือกวิธีจ่ายเงิน');
  if (payMethod === 'cod' && !truthy_(settings.ALLOW_COD)) fail_('invalid', 'ร้านยังไม่รับเงินสดปลายทาง');
  const upd = updateOrder_(o, { status: 'confirmed', payMethod: payMethod, confirmedAt: new Date() },
    'customer', payMethod === 'cod' ? 'จ่ายเงินสดตอนรับข้าว' : 'โอนเงิน / สแกนจ่าย');
  const view = orderView_(upd);
  try {
    notifyAdmins_([flexAdminEvent_(view, settings, 'ลูกค้ายืนยันสั่งซื้อแล้ว',
      'ยอด ฿' + money_(view.total) + ' — ' + (payMethod === 'cod' ? 'จ่ายเงินสดตอนรับข้าว' : 'จะโอนเงิน / สแกนจ่าย'))]);
  } catch (err) { console.error(err); }
  return view;
}

function apiUploadSlip_(user, req) {
  const o = ownOrder_(user, req.orderId);
  if (['confirmed', 'slip'].indexOf(o.status) < 0) fail_('bad_status', 'ส่งสลิปไม่ได้ เพราะคำสั่งซื้อนี้ "' + STATUS_LABEL[o.status] + '"');
  const b64 = String(req.image || '').replace(/^data:[^,]+,/, '');
  if (b64.length < 100) fail_('invalid', 'ไม่พบรูปสลิป');
  if (b64.length > 8000000) fail_('too_big', 'รูปใหญ่เกินไป กรุณาเลือกรูปใหม่');
  const mime = /^image\/(jpeg|png|webp)$/.test(req.mime) ? req.mime : 'image/jpeg';
  const ext = mime.split('/')[1].replace('jpeg', 'jpg');
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, o.orderId + '_' + Date.now() + '.' + ext);
  const file = slipFolder_().createFile(blob);
  file.setDescription('สลิปคำสั่งซื้อ ' + o.orderId + ' จาก ' + (o.fullName || o.lineName));

  return withLock_(function () {
    const cur = getOrderRow_(o.orderId);
    const upd = updateOrder_(cur, { status: 'slip', payMethod: 'transfer', slipUrl: file.getUrl(), slipAt: new Date() },
      'customer', 'ส่งรูปสลิปโอนเงิน');
    const view = orderView_(upd);
    try { notifyAdmins_([flexAdminEvent_(view, getSettings_(), 'ลูกค้าส่งสลิปโอนเงินแล้ว', 'ยอด ฿' + money_(view.total) + ' — กรุณาตรวจสอบ')]); } catch (err) { console.error(err); }
    return view;
  });
}

function apiCancelOrder_(user, orderId) {
  const o = ownOrder_(user, orderId);
  if (['new', 'quoted', 'confirmed'].indexOf(o.status) < 0) fail_('bad_status', 'ยกเลิกเองไม่ได้แล้ว กรุณาโทรหาร้าน');
  const upd = updateOrder_(o, { status: 'cancelled', cancelReason: 'ลูกค้ายกเลิกเอง' }, 'customer', 'ลูกค้ายกเลิกเอง');
  const view = orderView_(upd);
  try { notifyAdmins_([flexAdminEvent_(view, getSettings_(), 'ลูกค้ายกเลิกคำสั่งซื้อ', view.itemsText || '')]); } catch (err) { console.error(err); }
  return view;
}

function nextOrderId_() {
  const d = Utilities.formatDate(new Date(), TZ, 'yyMMdd');
  const props = PropertiesService.getScriptProperties();
  const key = 'SEQ_' + d;
  const n = Number(props.getProperty(key) || 0) + 1;
  if (n === 1) {
    Object.keys(props.getProperties()).forEach(function (k) { if (/^SEQ_/.test(k) && k !== key) props.deleteProperty(k); });
  }
  props.setProperty(key, String(n));
  return 'R' + d + '-' + ('00' + n).slice(-3);
}

function slipFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SLIP_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* สร้างใหม่ */ } }
  const folder = DriveApp.createFolder('สลิปโอนเงิน — ระบบสั่งข้าว');
  props.setProperty('SLIP_FOLDER_ID', folder.getId());
  return folder;
}

/**
 * ร้านเปิดอยู่ตอนนี้ไหม (เวลาไทย) จาก SHOP_HOURS เช่น "วันจันทร์–วันเสาร์ 8.00–17.00 น."
 * คืน true/false หรือ null ถ้าอ่านเวลาทำการไม่ออก (ไม่บังคับ)
 */
function shopOpenNow_(settings) {
  const t = String(settings.SHOP_HOURS || '');
  const m = t.match(/(\d{1,2})[.:](\d{2})\s*(?:น\.?)?\s*[-–—ถึง]+\s*(\d{1,2})[.:](\d{2})/);
  if (!m) return null;
  const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];
  let days = [0, 1, 2, 3, 4, 5, 6];
  if (!/ทุกวัน/.test(t)) {
    const idx = function (name) { for (let i = 0; i < 7; i++) if (name.indexOf(DAYS[i]) >= 0) return i; return -1; };
    const r = t.match(/(อาทิตย์|จันทร์|อังคาร|พุธ|พฤหัส\S*|ศุกร์|เสาร์)\s*[-–—ถึง]+\s*(?:วัน)?(อาทิตย์|จันทร์|อังคาร|พุธ|พฤหัส\S*|ศุกร์|เสาร์)/);
    if (r) {
      const a = idx(r[1]), b = idx(r[2]);
      days = [];
      for (let i = a; ; i = (i + 1) % 7) { days.push(i); if (i === b || days.length > 7) break; }
    } else {
      const listed = DAYS.map(function (d, i) { return t.indexOf(d) >= 0 ? i : -1; }).filter(function (i) { return i >= 0; });
      if (listed.length) days = listed;
    }
  }
  const now = new Date();
  const dow = Number(Utilities.formatDate(now, TZ, 'u')) % 7;           // u: 1=จันทร์ … 7=อาทิตย์
  const mins = Number(Utilities.formatDate(now, TZ, 'H')) * 60 + Number(Utilities.formatDate(now, TZ, 'm'));
  return days.indexOf(dow) >= 0 && mins >= (+m[1] * 60 + +m[2]) && mins < (+m[3] * 60 + +m[4]);
}

/* =========================================================
 * Admin API
 * ========================================================= */

function apiAdminClaim_(user, code) {
  const real = prop_('ADMIN_SETUP_CODE');
  if (!real || String(code || '').trim() !== real) {
    Utilities.sleep(1500);
    fail_('bad_code', 'รหัสไม่ถูกต้อง');
  }
  if (!isAdmin_(user.userId)) {
    insertRow_('Admins', { userId: user.userId, name: user.name, notify: true, addedAt: new Date() });
    CacheService.getScriptCache().remove('admins');
  }
  return { ok: true };
}

function apiAdminBootstrap_(admin) {
  const custMap = {};
  readAll_('Customers').forEach(function (c) { custMap[c.userId] = { linePicture: c.linePicture, orderCount: num_(c.orderCount) }; });
  const orders = readAll_('Orders')
    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })
    .slice(0, 800)
    .map(function (o) { const v = orderView_(o); v.customer = custMap[o.userId] || {}; v.itemsText = o.itemsText; return v; });
  return {
    admin: admin,
    orders: orders,
    products: getProducts_(false),
    settings: getSettings_(),
    sheetUrl: ss_().getUrl(),
    zort: zortStatus_(),
    serverTime: new Date().toISOString(),
  };
}

/** ปุ่ม "ยกเลิกใน ZORT แล้ว" — แอดมินยืนยันว่าไปยกเลิก (Void) ในหน้า ZORT เรียบร้อย */
function apiAdminZortVoidDone_(admin, req) {
  const o = getOrderRow_(req.orderId);
  if (!o) fail_('not_found', 'ไม่พบคำสั่งซื้อ');
  if (o.zortVoidStatus !== 'pending') fail_('bad_status', 'คำสั่งซื้อนี้ไม่ได้รอยกเลิกใน ZORT');
  const upd = updateOrder_(o, { zortVoidStatus: 'done', zortVoidAt: new Date(), zortVoidBy: admin.name },
    'admin:' + admin.name, 'ยกเลิกใน ZORT แล้ว (รหัส ' + o.zortOrderId + ')');
  return { order: orderView_(upd) };
}

/** ปุ่ม "ส่งเข้า ZORT อีกครั้ง" ในหน้าแอดมิน */
function apiAdminZortPushOrder_(req) {
  const o = getOrderRow_(req.orderId);
  if (!o) fail_('not_found', 'ไม่พบคำสั่งซื้อ');
  if (o.status !== 'done') fail_('bad_status', 'บันทึกยอดขายเข้า ZORT ได้เมื่อปิดการขายแล้วเท่านั้น');
  const zort = pushOrderToZort_(o, true);
  return { order: orderView_(getOrderRow_(o.orderId)), zort: zort };
}

/** ปุ่ม "ดึงสินค้าจาก ZORT" ในหน้าแอดมิน */
function apiAdminZortSync_() {
  const result = syncZortProducts();
  return { result: result, products: getProducts_(false), zort: zortStatus_() };
}

function apiAdminQuote_(admin, req) {
  const o = getOrderRow_(req.orderId);
  if (!o) fail_('not_found', 'ไม่พบคำสั่งซื้อ');
  if (['new', 'quoted', 'confirmed'].indexOf(o.status) < 0) {
    fail_('bad_status', 'ส่งราคาไม่ได้ เพราะคำสั่งซื้อนี้ "' + STATUS_LABEL[o.status] + '"');
  }
  const lines = (Array.isArray(req.lines) ? req.lines : []).slice(0, 40).map(function (l) {
    const qty = Math.max(0, Math.floor(num_(l.qty)));
    const unitPrice = Math.max(0, round2_(num_(l.unitPrice)));
    return {
      productId: clean_(l.productId, 40), name: clean_(l.name, 120) || 'สินค้า', sizeKg: num_(l.sizeKg),
      unit: clean_(l.unit, 20) || 'ถุง', qty: qty, unitPrice: unitPrice, amount: round2_(qty * unitPrice),
    };
  }).filter(function (l) { return l.qty > 0; });
  if (!lines.length) fail_('invalid', 'ต้องมีสินค้าอย่างน้อย 1 รายการ');

  const subtotal = round2_(lines.reduce(function (s, l) { return s + l.amount; }, 0));
  const shippingFee = Math.max(0, round2_(num_(req.shippingFee)));
  const discount = Math.max(0, round2_(num_(req.discount)));
  const total = Math.max(0, round2_(subtotal + shippingFee - discount));
  if (total <= 0) fail_('invalid', 'ยอดรวมต้องมากกว่า 0 บาท');

  const quote = {
    lines: lines, subtotal: subtotal, shippingFee: shippingFee, discount: discount, total: total,
    note: clean_(req.note, 300), by: admin.name, at: new Date().toISOString(),
  };
  const upd = updateOrder_(o, {
    status: 'quoted', quoteJson: JSON.stringify(quote), subtotal: subtotal, shippingFee: shippingFee,
    discount: discount, total: total, quoteNote: quote.note, quotedAt: new Date(), payMethod: '', confirmedAt: '',
  }, 'admin:' + admin.name, 'แจ้งราคา ฿' + money_(total));
  const view = orderView_(upd);
  const push = pushToUser_(o.userId, [flexQuote_(view, getSettings_())]);
  return { order: view, pushed: !!push.ok, pushError: push.error || '' };
}

function apiAdminSetStatus_(admin, req) {
  const o = getOrderRow_(req.orderId);
  if (!o) fail_('not_found', 'ไม่พบคำสั่งซื้อ');
  const to = String(req.status || '');
  const from = o.status;
  if ((ADMIN_TRANSITIONS[from] || []).indexOf(to) < 0) {
    fail_('bad_status', 'เปลี่ยนจาก "' + STATUS_LABEL[from] + '" เป็น "' + (STATUS_LABEL[to] || to) + '" ไม่ได้');
  }
  if (from === 'confirmed' && to === 'done' && o.payMethod !== 'cod') {
    fail_('bad_status', 'คำสั่งซื้อนี้ลูกค้าเลือกโอนเงิน กรุณากด "ได้รับเงินแล้ว" ก่อน');
  }
  if (from === 'confirmed' && to === 'shipping' && o.payMethod !== 'cod') {
    fail_('bad_status', 'คำสั่งซื้อนี้ลูกค้าเลือกโอนเงิน กรุณากด "ได้รับเงินแล้ว" ก่อนจัดส่ง');
  }
  const note = clean_(req.note, 300);
  const now = new Date();
  const patch = { status: to };
  if (to === 'confirmed') {
    patch.payMethod = ['transfer', 'cod'].indexOf(req.payMethod) >= 0 ? req.payMethod : (o.payMethod || 'transfer');
    if (from === 'quoted') patch.confirmedAt = now;
  }
  if (to === 'paid') patch.paidAt = now;
  if (to === 'shipping') patch.shippedAt = now;
  if (to === 'done') { patch.doneAt = now; if (!o.paidAt) patch.paidAt = now; }
  if (to === 'cancelled') patch.cancelReason = note || 'ร้านยกเลิก';
  // ยกเลิกคำสั่งซื้อที่บันทึกยอดขายใน ZORT แล้ว → ระบบยกเลิกใน ZORT ให้ไม่ได้ ติดป้ายให้แอดมินไปยกเลิกเอง
  const needZortVoid = to === 'cancelled' && !!o.zortOrderId;
  if (needZortVoid) {
    ensureSheet_(ss_(), 'Orders', SCHEMA.Orders);
    patch.zortVoidStatus = 'pending';
  }

  const upd = updateOrder_(o, patch, 'admin:' + admin.name, needZortVoid
    ? (note ? note + ' · ' : '') + 'ต้องไปยกเลิกใน ZORT (รหัส ' + o.zortOrderId + ')'
    : note);
  // ปิดการขาย → บันทึกยอดขายเข้า ZORT (ไม่สำเร็จก็ไม่ขวาง จดสาเหตุไว้ให้กดส่งใหม่)
  let zort = null;
  if (to === 'done') zort = pushOrderToZort_(getOrderRow_(o.orderId));
  const view = orderView_(zort ? getOrderRow_(o.orderId) : upd);
  let push = { ok: false, skipped: true };
  if (req.notify !== false) push = pushToUser_(o.userId, [flexStatus_(view, getSettings_(), { from: from, note: note })]);
  if (needZortVoid) {
    try {
      notifyAdmins_([{ type: 'text', text: '⚠️ ยกเลิกคำสั่งซื้อ #' + o.orderId + ' แล้ว แต่รายการนี้บันทึกยอดขายใน ZORT ไว้ (รหัส ' + o.zortOrderId + ')\nกรุณาไปยกเลิก (Void) ในหน้า ZORT แล้วกด "ยกเลิกใน ZORT แล้ว" ในหน้าแอดมิน' }]);
    } catch (err) { console.error(err); }
  }
  return { order: view, pushed: !!push.ok, pushError: push.error || '', zort: zort, needZortVoid: needZortVoid };
}
