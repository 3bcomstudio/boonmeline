/**
 * Zort.gs — ดึงข้อมูลสินค้าข้าวจาก ZORT (zortout.com) ผ่าน ZORT Open API v4
 *            ZORT เป็นแหล่งข้อมูลข้าวแหล่งเดียว: แท็บ Products ถูกเขียนใหม่ทั้งแท็บทุกครั้งที่ซิงก์
 *            (แก้ชื่อ/ราคา/รูป/เปิด-ปิดขาย ที่ ZORT เท่านั้น — แก้ในชีตจะถูกทับ)
 *
 * เอกสาร API: https://developers.zortout.com/api-reference/product
 *   GET https://open-api.zortout.com/v4/Product/GetProducts
 *   GET https://open-api.zortout.com/v4/Product/GetCategorys
 *   GET https://open-api.zortout.com/v4/Product/GetProductDetail?id=
 *   Header ทุกคำขอ: storename, apikey, apisecret
 *
 * Script Properties (ความลับ — ห้ามใส่ในชีต):
 *   ZORT_STORENAME   — storename ของร้านใน ZORT
 *   ZORT_APIKEY      — API Key
 *   ZORT_APISECRET   — API Secret
 *
 * แท็บ Settings (ปรับได้โดยไม่ต้องแก้โค้ด):
 *   ZORT_CATEGORY_IDS      — id หมวดสินค้าข้าวใน ZORT คั่นด้วย , (ดูได้จาก zortListCategories)
 *   ZORT_KEYWORD           — คำที่ต้องมีในชื่อ/หมวด/SKU เช่น ข้าว (คั่นหลายคำด้วย ,) ใช้เมื่อไม่ระบุหมวด
 *   ZORT_WAREHOUSE_CODE    — รหัสคลัง ถ้าต้องการสต็อกเฉพาะคลัง (ว่าง = รวมทุกคลัง)
 *   (ข้าวที่สต็อก ZORT เหลือ 0 จะไม่แสดงในหน้าลูกค้าเสมอ — ดู getProducts_ ใน Db.gs)
 *
 * ฟังก์ชันที่รันจากหน้า Apps Script ได้:
 *   testZort()            — ทดสอบการเชื่อมต่อ และแสดงสินค้า 5 รายการแรก
 *   zortListCategories()  — แสดงหมวดสินค้าทั้งหมดพร้อม id
 *   zortPreview()         — แสดงสินค้าที่จะถูกดึง (ยังไม่เขียนชีต)
 *   syncZortProducts()    — ล้างแท็บ Products แล้วเขียนสินค้าข้าวจาก ZORT ลงไปใหม่ (ลบข้าวเดิมที่ไม่ได้มาจาก ZORT)
 *   zortCheck()           — ตรวจว่าสินค้าในคลัง ZORT มาครบไหม (แสดงรายการที่ถูกข้ามพร้อมเหตุผล)
 *   previewZortOrder()    — ดูข้อมูลยอดขายที่จะส่งเข้า ZORT (ไม่ส่งจริง)
 *   pushPendingOrdersToZort() — ส่งยอดขายที่ปิดแล้วแต่ยังไม่ได้บันทึกใน ZORT
 *   installZortTrigger()  — ตั้งให้ซิงก์อัตโนมัติทุก 1 ชั่วโมง
 *   removeZortTrigger()   — ยกเลิกการซิงก์อัตโนมัติ
 */

const ZORT_BASE_URL = 'https://open-api.zortout.com/v4';
const ZORT_PAGE_LIMIT = 500;   // ZORT กำหนดสูงสุด 500 ต่อหน้า
const ZORT_MAX_PAGES = 40;     // กันวนไม่รู้จบ (สูงสุด 20,000 รายการ)

/* =========================================================
 * HTTP client
 * ========================================================= */

function zortConfigured_() {
  return !!(prop_('ZORT_STORENAME') && prop_('ZORT_APIKEY') && prop_('ZORT_APISECRET'));
}

function zortHeaders_() {
  if (!zortConfigured_()) {
    fail_('zort_config', 'ยังไม่ได้ตั้งค่า ZORT_STORENAME, ZORT_APIKEY, ZORT_APISECRET ใน Script Properties');
  }
  return {
    storename: prop_('ZORT_STORENAME'),
    apikey: prop_('ZORT_APIKEY'),
    apisecret: prop_('ZORT_APISECRET'),
    'X-Request-ID': Utilities.getUuid(),
  };
}

/**
 * เรียก ZORT API แล้วคืน JSON — โยน error ภาษาไทยถ้าไม่สำเร็จ
 * @param {string} path เช่น 'Product/GetProducts'
 * @param {Object} query query string
 * @param {Object=} extraHeaders header เพิ่มเติม เช่น skulist
 */
function zortGet_(path, query, extraHeaders) {
  return zortRequest_('get', path, query, null, extraHeaders);
}

function zortPost_(path, query, body) {
  return zortRequest_('post', path, query, body, null);
}

function zortRequest_(method, path, query, body, extraHeaders) {
  const qs = Object.keys(query || {})
    .filter(function (k) { return query[k] !== '' && query[k] !== null && query[k] !== undefined; })
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]); })
    .join('&');
  const url = ZORT_BASE_URL + '/' + path + (qs ? '?' + qs : '');
  const headers = Object.assign(zortHeaders_(), extraHeaders || {});

  const opts = { method: method, headers: headers, muteHttpExceptions: true };
  if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  let res;
  for (let attempt = 1; attempt <= 3; attempt++) {
    res = UrlFetchApp.fetch(url, opts);
    const http = res.getResponseCode();
    if (http !== 429 && http < 500) break;      // ลองใหม่เฉพาะกรณีเซิร์ฟเวอร์ล่ม/ถูกจำกัดความถี่
    Utilities.sleep(1000 * attempt * attempt);
  }

  const http = res.getResponseCode();
  const text = res.getContentText();
  const data = parseJson_(text, null);
  if (http === 401 || http === 403) {
    fail_('zort_auth', 'ZORT ปฏิเสธการเชื่อมต่อ (HTTP ' + http + ') — ตรวจ storename / apikey / apisecret อีกครั้ง');
  }
  if (http !== 200 || !data) {
    fail_('zort_http', 'เชื่อมต่อ ZORT ไม่สำเร็จ (HTTP ' + http + '): ' + String(text).slice(0, 200));
  }
  // เอกสาร ZORT ระบุผลลัพธ์เป็น res.resCode / res.resDesc (บางหน้าเขียนเป็น res เฉย ๆ) — รองรับทั้งสองแบบ
  const r = data.res;
  const code = r && typeof r === 'object' ? String(r.resCode || '') : String(r || data.resCode || '');
  const desc = r && typeof r === 'object' ? String(r.resDesc || '') : String(data.resDesc || '');
  if (code && code !== '200' && code !== '201') {
    const err = new Error('ZORT ตอบกลับ error ' + code + (desc ? ': ' + desc : ''));
    err.code = 'zort_error';
    err.zortCode = code;
    throw err;
  }
  return data;
}

/* =========================================================
 * Product API
 * ========================================================= */

/** หา array รายการในผลลัพธ์ (เอกสารระบุ list แต่เผื่อ ZORT ห่อข้อมูลต่างไป) */
function zortList_(data) {
  if (!data) return [];
  if (Array.isArray(data.list)) return data.list;
  const keys = ['data', 'products', 'items', 'result'];
  for (let i = 0; i < keys.length; i++) {
    const v = data[keys[i]];
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.list)) return v.list;
  }
  return [];
}

/** ดึงได้ 0 รายการ → ตรวจว่าร้านมีสินค้าไหม ชื่อ/หมวดหน้าตาแบบไหน แล้วบอกวิธีแก้ */
function zortDiagnose_() {
  const s = getSettings_();
  const data = zortGet_('Product/GetProducts', { page: 1, limit: 20 });
  const list = zortList_(data);
  const total = Number(data.count) || list.length;
  const filter = String(s.ZORT_CATEGORY_IDS || '').trim()
    ? 'หมวด ZORT_CATEGORY_IDS = ' + s.ZORT_CATEGORY_IDS
    : (String(s.ZORT_KEYWORD || '').trim() ? 'คำค้น ZORT_KEYWORD = "' + s.ZORT_KEYWORD + '"' : 'ไม่กรอง');
  if (!list.length) {
    return 'ZORT ตอบกลับสำเร็จแต่ไม่มีรายการสินค้าเลย (ช่องข้อมูลที่ได้: ' + Object.keys(data).join(', ') +
      ') — ตรวจว่า storename ถูกร้าน และ API Key ผูกกับคลังที่มีสินค้า';
  }
  const cats = {};
  list.forEach(function (p) { if (p.category) cats[p.category + ' (id ' + p.categoryid + ')'] = true; });
  return 'ร้านมีสินค้าใน ZORT ' + total + ' รายการ แต่ใช้ ' + filter + ' แล้วไม่เจอ' +
    ' | ตัวอย่างชื่อ: ' + list.slice(0, 4).map(function (p) { return p.name; }).join(', ') +
    (Object.keys(cats).length ? ' | หมวดที่พบ: ' + Object.keys(cats).slice(0, 6).join(', ') : ' | สินค้ายังไม่ได้จัดหมวด') +
    ' → แก้ ZORT_CATEGORY_IDS หรือ ZORT_KEYWORD ในแท็บ Settings (ล้างทั้งคู่ = ดึงทั้งร้าน)';
}

/** ดึงสินค้าทุกหน้าตามเงื่อนไข (คืน array ของ product object จาก ZORT) */
function zortGetAllProducts_(filter, info) {
  const out = [];
  let prevFirst = null, count = 0, pages = 0;
  for (let page = 1; page <= ZORT_MAX_PAGES; page++) {
    const q = Object.assign({}, filter || {}, { page: page, limit: ZORT_PAGE_LIMIT });
    const data = zortGet_('Product/GetProducts', q);
    const list = zortList_(data);
    if (!list.length) break;
    const first = list[0] && list[0].id;
    if (page > 1 && first === prevFirst) break;               // ZORT ส่งหน้าเดิมซ้ำ (ไม่รองรับ page) — หยุด
    prevFirst = first;
    pages++;
    Array.prototype.push.apply(out, list);
    count = Math.max(count, Number(data.count) || 0);
    // หยุดเมื่อครบตามจำนวนที่ ZORT บอก — ไม่ใช้ "ได้น้อยกว่า 500" เพราะ ZORT อาจจำกัดต่อหน้าน้อยกว่าที่ขอ
    if (count && out.length >= count) break;
    if (!count && list.length < ZORT_PAGE_LIMIT && page > 1) break;
  }
  if (info) { info.pages = (info.pages || 0) + pages; info.count = (info.count || 0) + count; }
  return out;
}

function zortGetCategories_() {
  const out = [];
  for (let page = 1; page <= ZORT_MAX_PAGES; page++) {
    const data = zortGet_('Product/GetCategorys', { page: page, limit: ZORT_PAGE_LIMIT });
    const list = zortList_(data);
    Array.prototype.push.apply(out, list);
    if (list.length < ZORT_PAGE_LIMIT) break;
  }
  return out;
}

function zortGetProductDetail_(id) {
  const s = getSettings_();
  return zortGet_('Product/GetProductDetail', { id: id, warehousecode: String(s.ZORT_WAREHOUSE_CODE || '').trim() });
}

/**
 * ดึงเฉพาะสินค้าข้าว ตามที่ตั้งใน Settings
 *   - ถ้ามี ZORT_CATEGORY_IDS → ดึงทีละหมวด
 *   - ไม่งั้นถ้ามี ZORT_KEYWORD → ค้นด้วยคำค้น
 *   - ไม่ตั้งทั้งคู่ → ดึงสินค้าทั้งร้าน
 */
function zortFetchRiceProducts_() {
  const s = getSettings_();
  const base = {
    activestatus: 1,                                       // เฉพาะสินค้าที่เปิดใช้งานใน ZORT
    warehousecode: String(s.ZORT_WAREHOUSE_CODE || '').trim(),
  };
  const catIds = String(s.ZORT_CATEGORY_IDS || '').split(/[,\s]+/).filter(function (x) { return /^\d+$/.test(x); });
  const keyword = String(s.ZORT_KEYWORD || '').trim();
  const info = {};
  const diag = {
    filter: catIds.length ? 'หมวด ' + catIds.join(', ') : keyword ? 'คำค้น "' + keyword + '"' : 'ทั้งร้าน',
    warehouse: base.warehousecode || 'ทุกคลัง',
    raw: 0, notMatched: 0, service: 0, inactive: 0, dup: 0, kept: 0,
    skipped: [],                                           // ตัวอย่างสินค้าที่ถูกข้าม { name, why }
  };
  const skip = function (p, why) { if (diag.skipped.length < 60) diag.skipped.push({ name: String(p.name || '#' + p.id), why: why }); };

  let list = [];
  if (catIds.length) {
    catIds.forEach(function (id) {
      list = list.concat(zortGetAllProducts_(Object.assign({ categoryid: id }, base), info));
    });
  } else if (keyword) {
    // กรองคำค้นเองในชื่อ/หมวด/SKU แทนการส่ง keyword ให้ ZORT (ช่องค้นหาของ ZORT ค้นภาษาไทยไม่เจอในบางร้าน)
    // คั่นหลายคำด้วย , เช่น "ข้าว, rice"
    const words = keyword.split(',').map(function (w) { return w.trim().toLowerCase(); }).filter(String);
    const all = zortGetAllProducts_(base, info);
    diag.raw = all.length;
    list = all.filter(function (p) {
      const text = [p.name, p.category, p.sku].join(' ').toLowerCase();
      const ok = words.some(function (w) { return text.indexOf(w) >= 0; });
      if (!ok) { diag.notMatched++; skip(p, 'ไม่มีคำว่า ' + words.join(' / ') + ' ในชื่อ หมวด หรือ SKU'); }
      return ok;
    });
  } else {
    list = zortGetAllProducts_(base, info);
  }
  if (!diag.raw) diag.raw = list.length;
  diag.zortCount = info.count || 0;
  diag.pages = info.pages || 0;

  const seen = {};
  const out = list.filter(function (p) {
    if (!p || p.id === undefined) return false;
    if (seen[p.id]) { diag.dup++; return false; }
    seen[p.id] = true;
    if (Number(p.producttype) === 1) { diag.service++; skip(p, 'เป็นสินค้าประเภทบริการ'); return false; }
    if (!zortIsActive_(p)) { diag.inactive++; skip(p, 'ปิดใช้งานใน ZORT'); return false; }
    return true;
  }).map(zortToProduct_);
  diag.kept = out.length;
  out.inactive = diag.inactive;
  out.diag = diag;
  return out;
}

/** สินค้าเปิดใช้งานใน ZORT หรือไม่ — รองรับค่า true/false, 1/0, "1"/"0", "true"/"false", "active"/"inactive" */
function zortIsActive_(z) {
  const keys = ['active', 'activestatus', 'isactive'];
  for (let i = 0; i < keys.length; i++) {
    const v = z[keys[i]];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'boolean') return v;
    return !/^(0|false|no|n|inactive|disabled?|closed?|off|ปิด|ไม่ใช้งาน|ปิดใช้งาน)$/i.test(String(v).trim());
  }
  return true;   // ZORT ไม่ส่งสถานะมา = ถือว่าเปิด (เพราะขอเฉพาะ activestatus=1 แล้ว)
}

/** แปลง product ของ ZORT เป็นรูปแบบเดียวกับแท็บ Products */
function zortToProduct_(z) {
  const fullName = clean_(z.name, 120);
  // ตัดขนาดออกจากชื่อ เช่น "ข้าวหอมมะลิ 5 กก." → "ข้าวหอมมะลิ" เพราะหน้าเว็บและ LINE ต่อท้าย "5 กก." ให้เองจาก sizeKg
  const shortName = fullName.replace(ZORT_SIZE_RE, ' ').replace(/\s+/g, ' ').replace(/[\s\-–(]+$/, '').trim();
  const name = shortName.length >= 2 ? shortName : fullName;
  return {
    zortId: String(z.id),
    sku: clean_(z.sku, 60),
    name: name,
    detail: clean_(String(z.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '), 200),
    sizeKg: zortSizeKg_(fullName, z.weight),
    unit: clean_(z.unittext, 20) || 'ถุง',
    price: round2_(num_(z.sellprice)),
    stock: zortStock_(z),
    image: zortImageUrl_(z),
    fullName: fullName,
    category: clean_(z.category, 80),
    active: true,                                           // ผ่านตัวกรองแล้ว = เปิดใช้งานเท่านั้น
  };
}

/** สต็อกพร้อมขาย — ZORT ไม่ส่งตัวเลขมา = null (ไม่ทราบ ยังแสดงขาย) */
function zortStock_(z) {
  const keys = ['availablestock', 'stock'];
  for (let i = 0; i < keys.length; i++) {
    const v = z[keys[i]];
    if (v !== undefined && v !== null && v !== '' && isFinite(Number(v))) return Number(v);
  }
  return null;
}

/** รูปจาก ZORT: imagepath ก่อน ถ้าไม่มีใช้รูปแรกใน imageList (เฉพาะ https) */
function zortImageUrl_(z) {
  const list = [z.imagepath, z.image, z.imageurl].concat(Array.isArray(z.imageList) ? z.imageList : [], Array.isArray(z.images) ? z.images : []);
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    let u = String((it && typeof it === 'object' ? (it.url || it.imagepath || it.path) : it) || '').trim();
    if (/^\/\//.test(u)) u = 'https:' + u;
    if (/^http:\/\//i.test(u)) u = 'https://' + u.slice(7);
    if (/^https:\/\//i.test(u)) return u;
  }
  return '';
}

/** สินค้าที่ไม่มีรูปในรายการ → ขอรายละเอียดสินค้าจาก ZORT เพื่อหารูป (จำกัดจำนวน/เวลา กันซิงก์นาน) */
const ZORT_DETAIL_IMG_MAX = 60;
function fillZortImages_(items, startedAt) {
  const stat = { detail: 0, found: 0, left: 0 };
  const props = PropertiesService.getScriptProperties();
  const miss = parseJson_(props.getProperty('ZORT_IMG_MISS'), {});     // สินค้าที่ ZORT ไม่มีรูป → รอ 1 วันค่อยถามใหม่
  const now = Date.now();
  Object.keys(miss).forEach(function (k) { if (now - miss[k] > 864e5) delete miss[k]; });
  const todo = items.filter(function (z) { return !z.image && !miss[z.zortId]; });
  for (let i = 0; i < todo.length; i++) {
    if (stat.detail >= ZORT_DETAIL_IMG_MAX || Date.now() - startedAt > 150000) { stat.left = todo.length - i; break; }
    stat.detail++;
    try {
      const d = zortGetProductDetail_(todo[i].zortId);
      const url = zortImageUrl_(d && (d.imagepath || d.imageList) ? d : (d && (d.data || d.product)) || {});
      if (url) { todo[i].image = url; stat.found++; } else miss[todo[i].zortId] = now;
    } catch (err) { console.error('ดึงรายละเอียดสินค้า #' + todo[i].zortId + ' ไม่ได้: ' + err.message); }
  }
  props.setProperty('ZORT_IMG_MISS', JSON.stringify(miss));
  return stat;
}

/** ขนาดถุง (กก.) — อ่านจากชื่อสินค้าก่อน เช่น "ข้าวหอมมะลิ 5 กก." ถ้าไม่มีใช้น้ำหนักใน ZORT (กรัม) */
const ZORT_SIZE_RE = /(\d+(?:\.\d+)?)\s*(?:กก\.?|กิโลกรัม|กิโล|kg\.?)(?![a-z])\)?/i;

function zortSizeKg_(name, weightGram) {
  const m = String(name).match(ZORT_SIZE_RE);
  if (m) return Number(m[1]);
  const g = num_(weightGram);
  return g > 0 ? Math.round(g / 100) / 10 : 0;
}

/* =========================================================
 * Sync ลงแท็บ Products
 * ========================================================= */

/**
 * ดึงสินค้าข้าวจาก ZORT แล้วเขียนแท็บ Products ใหม่ทั้งแท็บ
 *   - ทุกช่องมาจาก ZORT: id (= z<zortId>), name, detail, category, sizeKg, unit, price, image, active, sku, zortId, stock
 *   - เก็บค่าเดิมไว้เฉพาะ priceWholesale และ sort (ZORT ไม่มีข้อมูลนี้) ของสินค้า zortId เดียวกัน
 *   - แถวที่ไม่ได้มาจาก ZORT (เช่น ข้าวตัวอย่าง p01–p10) ถูกลบออก
 *   - ถ้าดึงจาก ZORT ไม่สำเร็จ หรือได้ 0 รายการ จะไม่แตะชีตเลย (กันรายการข้าวหายหมดเพราะเน็ตหรือตั้งค่าผิด)
 */
function syncZortProducts(opts) {
  const startedAt = Date.now();
  const result = withLock_(function () {
    const items = zortFetchRiceProducts_();
    if (!items.length) {
      fail_('zort_empty', 'ดึงจาก ZORT ได้ 0 รายการ' + (items.inactive ? ' (ข้ามสินค้าที่ปิดใช้งาน ' + items.inactive + ' รายการ)' : '') + ' จึงยังไม่แก้แท็บ Products — ' + zortDiagnose_());
    }

    const ss = ss_();
    ensureSheet_(ss, 'Products', SCHEMA.Products);
    const sh = ss.getSheetByName('Products');
    const h = headers_(sh);

    const keep = {};
    let removed = 0;
    readAll_('Products').forEach(function (r) {
      if (r.zortId !== '' && r.zortId !== undefined) keep[String(r.zortId)] = r;
      else removed++;
    });

    // รูปสินค้า: ใช้รูปจาก ZORT อย่างเดียว (ไม่ค้นรูปตามชื่อสินค้าจากที่อื่น)
    //   ไม่มีรูปในรายการ แต่รอบก่อนเคยได้รูปจากรายละเอียดสินค้าใน ZORT → ใช้รูปนั้นต่อ (รูปเก่าจาก Drive/เว็บ ไม่ใช้แล้ว)
    items.forEach(function (z) {
      const prev = keep[z.zortId] && String(keep[z.zortId].image || '').trim();
      if (!z.image && prev && /^https:\/\//i.test(prev) && !/googleusercontent\.com/i.test(prev)) z.image = prev;
    });
    const detailStat = fillZortImages_(items, startedAt);
    const imgStat = { zort: 0, none: 0, detail: detailStat.detail, detailFound: detailStat.found, detailLeft: detailStat.left };

    const now = new Date();
    let nextSort = Object.keys(keep).reduce(function (m, k) { return Math.max(m, num_(keep[k].sort)); }, 0) + 1;
    let added = 0;
    const objs = items.map(function (z) {
      const old = keep[z.zortId];
      if (!old) added++;
      imgStat[z.image ? 'zort' : 'none']++;
      return {
        id: 'z' + z.zortId, name: z.name, detail: z.detail, category: z.category, sizeKg: z.sizeKg, unit: z.unit,
        price: z.price, priceWholesale: old ? old.priceWholesale : '', image: z.image, active: z.active,
        sort: old && num_(old.sort) ? num_(old.sort) : nextSort++,
        sku: z.sku, zortId: z.zortId, stock: z.stock, syncedAt: now,
      };
    }).sort(function (a, b) { return a.sort - b.sort; });
    const gone = Object.keys(keep).filter(function (k) {
      return !items.some(function (z) { return z.zortId === k; });
    }).length;

    const last = sh.getLastRow();
    if (last >= 2) sh.getRange(2, 1, last - 1, sh.getMaxColumns()).clearContent();
    sh.getRange(2, 1, objs.length, h.length).setValues(objs.map(function (o) {
      return h.map(function (k) { return cellValue_(o[k]); });
    }));

    clearCache();
    const result = {
      fetched: items.length, updated: items.length - added, added: added,
      removed: removed + gone, inactive: items.inactive || 0, at: now.toISOString(),
      images: imgStat,
      diag: items.diag,
      outOfStock: objs.filter(function (o) { return o.stock !== null && o.stock !== undefined && o.stock <= 0; }).map(function (o) { return o.name + (o.sizeKg ? ' ' + o.sizeKg + ' กก.' : ''); }),
    };
    return result;
  });
  const saved = Object.assign({}, result, { diag: undefined, outOfStock: (result.outOfStock || []).length });
  PropertiesService.getScriptProperties().setProperty('ZORT_LAST_SYNC', JSON.stringify(saved));
  console.log('ZORT sync: ' + JSON.stringify(result));
  return result;
}

/* =========================================================
 * บันทึกการขายกลับไปที่ ZORT (เมื่อปิดการขาย = สถานะ done)
 *   POST /v4/Order/AddOrder?uniquenumber=<เลขคำสั่งซื้อ>  — status "Success" พร้อมการชำระเงิน
 *   ใช้เลขคำสั่งซื้อของระบบ (เช่น R261107-001) เป็น number และ uniquenumber กันบันทึกซ้ำ
 *   ผลลัพธ์เก็บในแท็บ Orders: zortOrderId, zortSyncedAt, zortError
 *
 * แท็บ Settings (ไม่ใส่ = ใช้ค่าเริ่มต้น):
 *   ZORT_PUSH_ORDERS       TRUE  — ส่งยอดขายเข้า ZORT อัตโนมัติเมื่อปิดการขาย
 *   ZORT_SALES_CHANNEL     LINE OA — ช่องทางการขายที่บันทึกใน ZORT
 *   ZORT_ORDER_VATTYPE     1     — 1 ไม่มี VAT / 2 แยก VAT / 3 รวม VAT
 *   ZORT_PAYMENT_TRANSFER  โอนเงิน — ชื่อวิธีชำระเงินใน ZORT เมื่อลูกค้าโอน
 *   ZORT_PAYMENT_CASH      เงินสด — ชื่อวิธีชำระเงินใน ZORT เมื่อจ่ายเงินสด
 * ========================================================= */

function zortPushEnabled_() {
  const s = getSettings_();
  if (!zortConfigured_()) return false;
  return s.ZORT_PUSH_ORDERS === undefined || s.ZORT_PUSH_ORDERS === '' || truthy_(s.ZORT_PUSH_ORDERS);
}

const zDate_ = function (v, fmt) {
  const d = v ? new Date(v) : new Date();
  return Utilities.formatDate(isNaN(d) ? new Date() : d, TZ, fmt);
};

/** SKU ของสินค้าในใบแจ้งราคา — จากแท็บ Products ก่อน ไม่พบ (ถูกลบ) ถาม ZORT จากรหัส z<id> */
function zortSkuOf_(productId, byId) {
  const p = byId[productId];
  if (p && p.sku) return p.sku;
  const m = String(productId || '').match(/^z(\d+)$/);
  if (m) {
    try {
      const d = zortGetProductDetail_(m[1]);
      const z = d && (d.sku ? d : (d.detail || d.product || {}));
      if (z && z.sku) return String(z.sku);
    } catch (e) { /* ด้านล่างแจ้งว่าไม่พบ SKU */ }
  }
  return '';
}

/** แปลงคำสั่งซื้อ (แถวในชีต) → body ของ ZORT AddOrder */
function buildZortOrder_(o) {
  const s = getSettings_();
  const q = parseJson_(o.quoteJson, null);
  if (!q || !Array.isArray(q.lines) || !q.lines.length) fail_('zort_order', 'คำสั่งซื้อนี้ยังไม่มีใบแจ้งราคา จึงบันทึกยอดขายไม่ได้');
  const byId = {};
  getProducts_(false).forEach(function (p) { byId[p.id] = p; });

  const missing = [];
  const list = q.lines.map(function (l) {
    const sku = zortSkuOf_(l.productId, byId);
    if (!sku) missing.push(l.name);
    return {
      sku: sku,
      name: String(l.name) + (num_(l.sizeKg) ? ' ' + num_(l.sizeKg) + ' กก.' : ''),
      number: num_(l.qty),
      pricepernumber: round2_(num_(l.unitPrice)),
      totalprice: round2_(num_(l.amount)),
    };
  });
  if (missing.length) fail_('zort_order', 'ไม่พบ SKU ของ: ' + missing.join(', ') + ' — สินค้านี้ไม่ได้มาจาก ZORT');

  const cod = o.payMethod === 'cod';
  const delivery = o.deliveryMethod !== 'pickup';
  const purpose = (typeof PURPOSES !== 'undefined' && PURPOSES[o.purpose]) || o.purpose || '';
  const body = {
    number: String(o.orderId),
    reference: String(o.orderId),
    orderdate: zDate_(o.createdAt, 'yyyy-MM-dd'),
    status: 'Success',
    amount: round2_(num_(q.total)),
    shippingamount: round2_(num_(q.shippingFee)),
    vattype: Number(s.ZORT_ORDER_VATTYPE) || 1,
    customername: String(o.fullName || o.lineName || 'ลูกค้า LINE'),
    customerphone: String(o.phone || ''),
    customeraddress: String(o.address || ''),
    saleschannel: String(s.ZORT_SALES_CHANNEL || 'LINE OA'),
    shippingchannel: delivery ? 'ร้านส่งเอง' : 'ลูกค้ารับที่ร้าน',
    shippingdate: zDate_(o.shippedAt || o.doneAt, 'yyyy-MM-dd'),
    paymentmethod: String(cod ? (s.ZORT_PAYMENT_CASH || 'เงินสด') : (s.ZORT_PAYMENT_TRANSFER || 'โอนเงิน')),
    paymentamount: round2_(num_(q.total)),
    paymentdate: zDate_(o.paidAt || o.doneAt, 'yyyy-MM-dd HH:mm'),
    isCOD: cod,
    description: ['สั่งผ่าน LINE', purpose ? 'ซื้อไป: ' + purpose : '', o.purposeNote ? String(o.purposeNote) : '', o.note ? 'หมายเหตุ: ' + o.note : '']
      .filter(String).join(' · ').slice(0, 500),
    tag: ['LINE OA'],
    list: list,
  };
  if (num_(q.discount) > 0) body.discount = round2_(num_(q.discount)).toFixed(2);
  if (delivery) {
    body.shippingname = body.customername;
    body.shippingphone = body.customerphone;
    body.shippingaddress = body.customeraddress;
  }
  const wh = String(s.ZORT_WAREHOUSE_CODE || '').trim();
  if (wh) body.warehousecode = wh;
  return body;
}

/**
 * บันทึกการขายของคำสั่งซื้อ (แถวในชีต) เข้า ZORT แล้วจดผลไว้ที่แถวนั้น
 * คืน { ok, id, already, skipped, error } — ไม่ throw (การปิดการขายต้องสำเร็จเสมอ)
 */
function pushOrderToZort_(o, force) {
  if (!o) return { ok: false, error: 'ไม่พบคำสั่งซื้อ' };
  if (o.zortOrderId) return { ok: true, id: String(o.zortOrderId), already: true };
  if (!force && !zortPushEnabled_()) return { ok: false, skipped: true };
  if (!zortConfigured_()) return { ok: false, error: 'ยังไม่ได้ตั้งค่า ZORT ใน Script Properties' };
  ensureSheet_(ss_(), 'Orders', SCHEMA.Orders);   // เพิ่มคอลัมน์ zortOrderId/zortSyncedAt/zortError ถ้ายังไม่มี

  let id = '', error = '';
  try {
    const body = buildZortOrder_(o);
    try {
      const data = zortPost_('Order/AddOrder', { uniquenumber: String(o.orderId) }, body);
      id = String((data.detail && data.detail.id) || data.id || '');
    } catch (err) {
      if (err.zortCode !== '900') throw err;
      // เลขซ้ำ = เคยบันทึกไปแล้ว (เช่น ส่งสำเร็จแต่บันทึกผลในชีตไม่ทัน) → ดึง id เดิม
      const d = zortGet_('Order/GetOrderDetail', { number: String(o.orderId) });
      id = String(d.id || (d.detail && d.detail.id) || 'มีอยู่แล้ว');
    }
  } catch (err) {
    error = String(err.message || err).slice(0, 300);
    console.error('ส่งยอดขายเข้า ZORT ไม่สำเร็จ ' + o.orderId + ': ' + error);
  }
  updateRow_('Orders', o._row, id
    ? { zortOrderId: id, zortSyncedAt: new Date(), zortError: '' }
    : { zortError: error, zortSyncedAt: new Date() });
  return id ? { ok: true, id: id } : { ok: false, error: error };
}

/** ส่งยอดขายที่ปิดแล้วแต่ยังไม่ได้บันทึกใน ZORT (รันเองจากหน้า Apps Script ได้) */
function pushPendingOrdersToZort() {
  const rows = readAll_('Orders').filter(function (o) { return o.status === 'done' && !o.zortOrderId; });
  let ok = 0;
  rows.forEach(function (o) { if (pushOrderToZort_(o, true).ok) ok++; });
  console.log('ส่งยอดขายเข้า ZORT สำเร็จ ' + ok + ' จาก ' + rows.length + ' รายการ');
}

/** ดูข้อมูลที่จะส่งเข้า ZORT ของคำสั่งซื้อล่าสุดที่ปิดการขายแล้ว (ไม่ส่งจริง) */
function previewZortOrder() {
  const o = readAll_('Orders').filter(function (x) { return x.status === 'done'; })
    .sort(function (a, b) { return String(b.doneAt).localeCompare(String(a.doneAt)); })[0];
  if (!o) { console.log('ยังไม่มีคำสั่งซื้อที่ปิดการขาย'); return; }
  console.log(JSON.stringify(buildZortOrder_(o), null, 2));
}

function zortStatus_() {
  return {
    configured: zortConfigured_(),
    pushOrders: zortPushEnabled_(),
    lastSync: parseJson_(prop_('ZORT_LAST_SYNC'), null),
  };
}

/* =========================================================
 * Trigger ซิงก์อัตโนมัติ
 * ========================================================= */

function zortSyncJob() {
  try { syncZortProducts(); } catch (err) { console.error('ZORT sync ล้มเหลว: ' + (err && err.message || err)); }
}

function installZortTrigger() {
  removeZortTrigger();
  ScriptApp.newTrigger('zortSyncJob').timeBased().everyHours(1).create();
  console.log('✅ ตั้งซิงก์สินค้าจาก ZORT อัตโนมัติทุก 1 ชั่วโมงแล้ว');
}

function removeZortTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'zortSyncJob'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
}

/* =========================================================
 * เครื่องมือทดสอบ (รันจากหน้า Apps Script แล้วดู Execution log)
 * ========================================================= */

function testZort() {
  const data = zortGet_('Product/GetProducts', { page: 1, limit: 5 });
  console.log('✅ เชื่อมต่อ ZORT สำเร็จ — สินค้าทั้งร้าน ' + (data.count || 0) + ' รายการ');
  console.log('ช่องข้อมูลที่ ZORT ส่งมา: ' + Object.keys(data).join(', '));
  zortList_(data).forEach(function (p) {
    console.log('#' + p.id + ' | SKU ' + p.sku + ' | ' + p.name + ' | ราคา ' + p.sellprice +
      ' | พร้อมขาย ' + p.availablestock + ' ' + (p.unittext || '') + ' | หมวด ' + (p.category || '-') + ' (id ' + p.categoryid + ')');
  });
}

function zortListCategories() {
  const list = zortGetCategories_();
  console.log('หมวดสินค้าใน ZORT ' + list.length + ' หมวด — นำ id ไปใส่ ZORT_CATEGORY_IDS ในแท็บ Settings');
  list.forEach(function (c) { console.log('id ' + c.id + ' — ' + c.name); });
}

function zortPreview() {
  const items = zortFetchRiceProducts_();
  console.log('จะดึงสินค้า ' + items.length + ' รายการ');
  items.forEach(function (p) {
    console.log('#' + p.zortId + ' | ' + p.sku + ' | ' + p.name + ' | ' + p.sizeKg + ' กก. | ฿' + p.price + ' | สต็อก ' + p.stock + ' ' + p.unit +
      ' | รูป: ' + (p.image ? 'มีใน ZORT' : 'ไม่มี — ใส่รูปที่สินค้าใน ZORT'));
  });
}

/** ตรวจว่าสินค้าในคลัง ZORT มาครบไหม — ดูผลใน Execution log (ไม่เขียนชีต) */
function zortCheck() {
  const items = zortFetchRiceProducts_();
  const d = items.diag;
  console.log('ตัวกรอง: ' + d.filter + ' | คลัง: ' + d.warehouse + ' | ZORT บอกว่ามี ' + d.zortCount + ' รายการ (' + d.pages + ' หน้า)');
  console.log('ได้จาก ZORT ' + d.raw + ' → ไม่ตรงคำค้น ' + d.notMatched + ' · บริการ ' + d.service + ' · ปิดใช้งาน ' + d.inactive + ' · ซ้ำ ' + d.dup + ' → ดึงเข้า ' + d.kept);
  d.skipped.forEach(function (x) { console.log('ข้าม: ' + x.name + ' — ' + x.why); });
  items.filter(function (p) { return p.stock !== null && p.stock <= 0; }).forEach(function (p) {
    console.log('สต็อกหมด (ไม่แสดงหน้าลูกค้า): ' + p.name + ' ' + p.sizeKg + ' กก.');
  });
}
