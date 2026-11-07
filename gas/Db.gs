/**
 * Db.gs — ตัวช่วยอ่าน/เขียน Google Sheets (ใช้ชีตเป็นฐานข้อมูล)
 *
 * แต่ละแท็บมีหัวคอลัมน์แถวที่ 1 ตาม SCHEMA ด้านล่าง
 * ระบบอ่านตำแหน่งคอลัมน์จากหัวตารางจริง จึงย้ายลำดับคอลัมน์ในชีตได้
 */

const TZ = 'Asia/Bangkok';

const SCHEMA = {
  Orders: [
    'orderId', 'createdAt', 'updatedAt', 'status',
    'userId', 'lineName', 'fullName', 'phone',
    'purpose', 'purposeNote',
    'deliveryMethod', 'address', 'lat', 'lng', 'distanceKm', 'wantDate',
    'itemsText', 'totalBags', 'totalKg', 'note',
    'subtotal', 'shippingFee', 'discount', 'total', 'quoteNote', 'quotedAt',
    'payMethod', 'confirmedAt', 'slipUrl', 'slipAt', 'paidAt', 'shippedAt', 'doneAt',
    'cancelReason', 'itemsJson', 'quoteJson', 'historyJson',
  ],
  Customers: [
    'userId', 'lineName', 'linePicture', 'fullName', 'phone',
    'address', 'lat', 'lng', 'purpose', 'purposeNote',
    'orderCount', 'createdAt', 'updatedAt',
  ],
  Products: [
    'id', 'name', 'detail', 'sizeKg', 'unit', 'price', 'priceWholesale', 'image', 'active', 'sort',
    'sku', 'zortId', 'stock', 'syncedAt', 'category',   // ← ซิงก์จาก ZORT (ดู Zort.gs)
  ],
  Settings: ['key', 'value', 'note'],
  Admins: ['userId', 'name', 'notify', 'addedAt'],
};

let SS_CACHE_ = null;

function ss_() {
  if (SS_CACHE_) return SS_CACHE_;
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  SS_CACHE_ = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!SS_CACHE_) throw new Error('ไม่พบ Google Sheet — กรุณารันฟังก์ชัน setup() ก่อน');
  return SS_CACHE_;
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('ไม่พบแท็บ "' + name + '" — กรุณารันฟังก์ชัน setup()');
  return sh;
}

function headers_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}

function rowObj_(h, r, rowNum) {
  const o = { _row: rowNum };
  h.forEach(function (k, i) {
    if (!k) return;
    o[k] = r[i] instanceof Date ? r[i].toISOString() : r[i];
  });
  return o;
}

/** แปลงค่าก่อนเขียนลงชีต — กันเลขศูนย์นำหน้าหาย และกันสูตร (=, +, -) จากข้อมูลที่ผู้ใช้พิมพ์ */
function cellValue_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  return /^[0-9+=\-@]/.test(s) ? "'" + s : s;
}

function readAll_(name) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const h = headers_(sh);
  return sh.getRange(2, 1, last - 1, h.length).getValues()
    .map(function (r, i) { return rowObj_(h, r, i + 2); })
    .filter(function (o) { return Object.keys(o).some(function (k) { return k !== '_row' && o[k] !== ''; }); });
}

function colIndex_(h, key) {
  const i = h.indexOf(key);
  if (i < 0) throw new Error('ไม่พบคอลัมน์ ' + key);
  return i + 1;
}

function findRow_(name, key, value) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2 || value === '' || value === null || value === undefined) return null;
  const h = headers_(sh);
  const cell = sh.getRange(2, colIndex_(h, key), last - 1, 1)
    .createTextFinder(String(value)).matchEntireCell(true).findNext();
  if (!cell) return null;
  const r = cell.getRow();
  return rowObj_(h, sh.getRange(r, 1, 1, h.length).getValues()[0], r);
}

function findRows_(name, key, value) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const h = headers_(sh);
  return sh.getRange(2, colIndex_(h, key), last - 1, 1)
    .createTextFinder(String(value)).matchEntireCell(true).findAll()
    .map(function (cell) {
      const r = cell.getRow();
      return rowObj_(h, sh.getRange(r, 1, 1, h.length).getValues()[0], r);
    });
}

function insertRow_(name, obj) {
  const sh = sheet_(name);
  const h = headers_(sh);
  const row = sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, h.length).setValues([h.map(function (k) { return cellValue_(obj[k]); })]);
  return Object.assign({ _row: row }, obj);
}

/** อัปเดตเฉพาะคอลัมน์ที่ส่งมาใน patch (คอลัมน์อื่นเขียนค่าเดิมกลับ) */
function updateRow_(name, rowNum, patch) {
  const sh = sheet_(name);
  const h = headers_(sh);
  const range = sh.getRange(rowNum, 1, 1, h.length);
  const raw = range.getValues()[0];
  const next = h.map(function (k, i) {
    return cellValue_(Object.prototype.hasOwnProperty.call(patch, k) ? patch[k] : raw[i]);
  });
  range.setValues([next]);
  return rowObj_(h, next.map(function (v) { return typeof v === 'string' && v.charAt(0) === "'" ? v.slice(1) : v; }), rowNum);
}

/* ---------- Settings / Products (แคช 60 วินาที) ---------- */

function getSettings_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('settings');
  if (hit) return JSON.parse(hit);
  const s = {};
  readAll_('Settings').forEach(function (r) { if (r.key) s[String(r.key).trim()] = r.value; });
  // ชีตที่สร้างจากเวอร์ชันแรกยังเป็นชื่อ "ร้านข้าวหอม" → เปลี่ยนให้อัตโนมัติครั้งเดียว (ดู fixShopName ใน Setup.gs)
  if (Object.keys(s).some(function (k) { return String(s[k]).indexOf(OLD_SHOP_NAME) >= 0; })) {
    try { fixShopName(); } catch (err) { console.error('fixShopName', err); }
    Object.keys(s).forEach(function (k) {
      if (typeof s[k] === 'string') s[k] = s[k].split(OLD_SHOP_NAME).join(NEW_SHOP_NAME);
    });
  }
  cache.put('settings', JSON.stringify(s), 60);
  return s;
}

function getProducts_(activeOnly) {
  const cache = CacheService.getScriptCache();
  let list = null;
  const hit = cache.get('products');
  if (hit) list = JSON.parse(hit);
  if (!list) {
    list = readAll_('Products').filter(function (p) { return p.id; }).map(function (p) {
      return {
        id: String(p.id),
        name: String(p.name || ''),
        detail: String(p.detail || ''),
        sizeKg: Number(p.sizeKg) || 0,
        unit: String(p.unit || 'ถุง'),
        price: Number(p.price) || 0,
        priceWholesale: Number(p.priceWholesale) || 0,
        image: String(p.image || ''),
        active: truthy_(p.active),
        sort: Number(p.sort) || 999,
        sku: String(p.sku || ''),
        zortId: String(p.zortId || ''),
        category: String(p.category || ''),
        stock: p.stock === '' || p.stock === undefined ? null : Number(p.stock) || 0,
      };
    }).sort(function (a, b) { return a.sort - b.sort; });
    cache.put('products', JSON.stringify(list), 60);
  }
  if (!activeOnly) return list;
  // ZORT_HIDE_OUT_OF_STOCK = TRUE → ซ่อนข้าวที่ผูกกับ ZORT แล้วสต็อกหมด
  const hideOos = truthy_(getSettings_().ZORT_HIDE_OUT_OF_STOCK);
  return list.filter(function (p) { return p.active && !(hideOos && p.zortId && p.stock !== null && p.stock <= 0); });
}

/** เรียกหลังแก้ชีต Settings/Products ถ้าอยากให้มีผลทันที */
function clearCache() {
  CacheService.getScriptCache().removeAll(['settings', 'products', 'admins']);
}

function admins_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('admins');
  if (hit) return JSON.parse(hit);
  const list = readAll_('Admins').filter(function (a) { return a.userId; });
  cache.put('admins', JSON.stringify(list), 120);
  return list;
}

/* ---------- helpers ---------- */

function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

function truthy_(v) {
  return v === true || /^(true|1|yes|y|ใช่|เปิด)$/i.test(String(v).trim());
}

function clean_(v, max) {
  return String(v === null || v === undefined ? '' : v).replace(/[\u0000-\u0008\u000B-\u001F]/g, '').trim().slice(0, max || 300);
}

function num_(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function round2_(n) {
  return Math.round(n * 100) / 100;
}

function money_(n) {
  const v = round2_(num_(n));
  return v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

function parseJson_(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch (e) { return fallback; }
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) fail_('busy', 'ระบบกำลังทำงานหนัก กรุณาลองใหม่อีกครั้ง');
  try { return fn(); } finally { lock.releaseLock(); }
}

function fail_(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function distanceKm_(settings, lat, lng) {
  const lat1 = Number(settings.SHOP_LAT), lng1 = Number(settings.SHOP_LNG);
  if (!lat || !lng || !lat1 || !lng1) return '';
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat - lat1) * rad, dLng = (lng - lng1) * rad;
  const a = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(lat1 * rad) * Math.cos(lat * rad) * Math.pow(Math.sin(dLng / 2), 2);
  return Math.round(2 * R * Math.asin(Math.sqrt(a)) * 10) / 10;
}
