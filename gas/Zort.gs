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
 *   ZORT_HIDE_OUT_OF_STOCK — TRUE = ซ่อนข้าวที่สต็อก ZORT เหลือ 0 จากหน้าลูกค้า
 *
 * ฟังก์ชันที่รันจากหน้า Apps Script ได้:
 *   testZort()            — ทดสอบการเชื่อมต่อ และแสดงสินค้า 5 รายการแรก
 *   zortListCategories()  — แสดงหมวดสินค้าทั้งหมดพร้อม id
 *   zortPreview()         — แสดงสินค้าที่จะถูกดึง (ยังไม่เขียนชีต)
 *   syncZortProducts()    — ล้างแท็บ Products แล้วเขียนสินค้าข้าวจาก ZORT ลงไปใหม่ (ลบข้าวเดิมที่ไม่ได้มาจาก ZORT)
 *   productImageFolder()  — แสดงลิงก์โฟลเดอร์รูปสินค้าใน Google Drive (ตั้งชื่อไฟล์ตาม SKU/ชื่อสินค้า)
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
function zortGetAllProducts_(filter) {
  const out = [];
  for (let page = 1; page <= ZORT_MAX_PAGES; page++) {
    const q = Object.assign({}, filter || {}, { page: page, limit: ZORT_PAGE_LIMIT });
    const data = zortGet_('Product/GetProducts', q);
    const list = zortList_(data);
    Array.prototype.push.apply(out, list);
    const count = Number(data.count) || 0;
    if (!list.length || list.length < ZORT_PAGE_LIMIT || (count && out.length >= count)) break;
  }
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

  let list = [];
  if (catIds.length) {
    catIds.forEach(function (id) {
      list = list.concat(zortGetAllProducts_(Object.assign({ categoryid: id }, base)));
    });
  } else if (keyword) {
    // กรองคำค้นเองในชื่อ/หมวด/SKU แทนการส่ง keyword ให้ ZORT (ช่องค้นหาของ ZORT ค้นภาษาไทยไม่เจอในบางร้าน)
    // คั่นหลายคำด้วย , เช่น "ข้าว, rice"
    const words = keyword.split(',').map(function (w) { return w.trim().toLowerCase(); }).filter(String);
    list = zortGetAllProducts_(base).filter(function (p) {
      const text = [p.name, p.category, p.sku].join(' ').toLowerCase();
      return words.some(function (w) { return text.indexOf(w) >= 0; });
    });
  } else {
    list = zortGetAllProducts_(base);
  }

  const seen = {};
  return list.filter(function (p) {
    if (!p || p.id === undefined || seen[p.id]) return false;
    seen[p.id] = true;
    return Number(p.producttype) !== 1;                     // ตัดสินค้าประเภท "บริการ"
  }).map(zortToProduct_);
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
    stock: num_(z.availablestock),
    image: zortImageUrl_(z),
    fullName: fullName,
    category: clean_(z.category, 80),
    active: z.active !== false,
  };
}

/** รูปจาก ZORT: imagepath ก่อน ถ้าไม่มีใช้รูปแรกใน imageList (เฉพาะ https) */
function zortImageUrl_(z) {
  const list = [z.imagepath].concat(Array.isArray(z.imageList) ? z.imageList : []);
  for (let i = 0; i < list.length; i++) {
    const u = String(list[i] || '').trim();
    if (/^https:\/\//i.test(u)) return u;
  }
  return '';
}

/* =========================================================
 * รูปสินค้าจาก Google Drive — โฟลเดอร์ "รูปสินค้า — ระบบสั่งข้าว"
 *   ตั้งชื่อไฟล์ตาม SKU หรือชื่อสินค้า แล้ววางในโฟลเดอร์ ระบบจับคู่ให้ทุกครั้งที่ซิงก์
 *   ลำดับการจับคู่: SKU → ชื่อเต็มใน ZORT (มีขนาด) → ชื่อสินค้า (ใช้ร่วมทุกขนาด)
 *   ไม่สนตัวพิมพ์ ช่องว่าง จุด และนามสกุลไฟล์ เช่น "ข้าวหอมมะลิ 5 กก.jpg" = "ข้าวหอมมะลิ5กก"
 * ========================================================= */

function productImageFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PRODUCT_IMG_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* สร้างใหม่ */ } }
  const folder = DriveApp.createFolder('รูปสินค้า — ระบบสั่งข้าว');
  folder.setDescription('ตั้งชื่อไฟล์รูปตาม SKU หรือชื่อสินค้าใน ZORT เช่น P0002.jpg หรือ ข้าวหอมมะลิ ตราฉัตรทอง.jpg — ระบบจับคู่ให้ทุกครั้งที่ดึงสินค้าจาก ZORT');
  props.setProperty('PRODUCT_IMG_FOLDER_ID', folder.getId());
  return folder;
}

const imgKey_ = function (s) {
  return String(s || '').replace(/\.(jpe?g|png|webp|gif|heic)$/i, '').toLowerCase().replace(/[\s.]+/g, '');
};

/** อ่านรูปทั้งหมดในโฟลเดอร์ → { คีย์ชื่อ: url } (เปิดสิทธิ์ "ทุกคนที่มีลิงก์ดูได้" ให้เอง) */
function driveImageMap_() {
  const map = {};
  const folder = productImageFolder_();
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (!/^image\//.test(f.getMimeType())) continue;
    try {
      if (f.getSharingAccess() !== DriveApp.Access.ANYONE_WITH_LINK && f.getSharingAccess() !== DriveApp.Access.ANYONE) {
        f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      }
    } catch (e) { console.error('ตั้งสิทธิ์รูป ' + f.getName() + ' ไม่ได้: ' + e.message); continue; }
    // ลิงก์รูปขนาดพอดีมือถือ (https) ใช้ได้ทั้งหน้าเว็บและข้อความ LINE
    map[imgKey_(f.getName())] = 'https://lh3.googleusercontent.com/d/' + f.getId() + '=w600';
  }
  return map;
}

/** เลือกรูปของสินค้า: รูปใน Drive (ร้านเลือกเอง) ก่อน → รูปจาก ZORT → ไม่มีรูป */
function resolveImage_(z, driveMap) {
  const keys = [z.sku, z.fullName, z.name];
  for (let i = 0; i < keys.length; i++) {
    const k = imgKey_(keys[i]);
    if (k && driveMap[k]) return { url: driveMap[k], from: 'drive' };
  }
  if (z.image) return { url: z.image, from: 'zort' };
  return { url: '', from: 'none' };
}

/* =========================================================
 * รูปจากอินเทอร์เน็ต (Brave Image Search) — ใช้เมื่อไม่มีรูปใน Drive และใน ZORT
 *   Script property: BRAVE_SEARCH_API_KEY  (สมัครที่ https://api-dashboard.search.brave.com/register)
 *   แท็บ Settings:   WEB_IMAGE_SEARCH = TRUE/FALSE, WEB_IMAGE_MAX_PER_SYNC = จำนวนค้นสูงสุดต่อการซิงก์
 *   รูปที่ได้จะดาวน์โหลดเก็บในโฟลเดอร์ย่อย "รูปจากเว็บ (อัตโนมัติ)" ชื่อไฟล์ z<zortId> → ครั้งต่อไปใช้ไฟล์เดิม ไม่ค้นซ้ำ
 *   ไม่ถูกใจรูป: ลบไฟล์นั้นทิ้ง (ระบบจะค้นใหม่) หรือวางรูปที่ถูกต้องในโฟลเดอร์หลัก (ใช้ก่อนเสมอ)
 * ========================================================= */

const BRAVE_IMAGE_URL = 'https://api.search.brave.com/res/v1/images/search';
const WEB_IMG_RETRY_DAYS = 7;   // ค้นไม่เจอ → รอ 7 วันค่อยค้นใหม่ (ประหยัดเครดิต)

function webImageFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('WEB_IMG_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* สร้างใหม่ */ } }
  const folder = productImageFolder_().createFolder('รูปจากเว็บ (อัตโนมัติ)');
  folder.setDescription('รูปที่ระบบค้นจากอินเทอร์เน็ตให้อัตโนมัติ — ชื่อไฟล์ z<รหัสสินค้า ZORT> ลบทิ้งได้ถ้ารูปไม่ถูก (ระบบจะค้นใหม่) หรือวางรูปที่ถูกต้องในโฟลเดอร์หลักแทน');
  props.setProperty('WEB_IMG_FOLDER_ID', folder.getId());
  return folder;
}

/** { 'z123': url } ของรูปที่เคยค้นและเก็บไว้แล้ว */
function webImageMap_() {
  const map = {};
  const it = webImageFolder_().getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (!/^image\//.test(f.getMimeType())) continue;
    map[imgKey_(f.getName())] = 'https://lh3.googleusercontent.com/d/' + f.getId() + '=w600';
  }
  return map;
}

/** ค้นรูปด้วยชื่อสินค้า แล้วดาวน์โหลดเก็บใน Drive — คืน url หรือ '' */
function fetchWebImage_(z) {
  const key = prop_('BRAVE_SEARCH_API_KEY');
  let q = String(z.fullName || z.name).trim();
  if (q.indexOf('ข้าว') < 0) q = 'ข้าว ' + q;
  const res = UrlFetchApp.fetch(BRAVE_IMAGE_URL + '?' + [
    'q=' + encodeURIComponent(q), 'search_lang=th', 'country=ALL', 'count=10', 'safesearch=strict', 'spellcheck=false',
  ].join('&'), { headers: { 'X-Subscription-Token': key, Accept: 'application/json' }, muteHttpExceptions: true });
  const http = res.getResponseCode();
  if (http === 401 || http === 403) fail_('web_img_auth', 'BRAVE_SEARCH_API_KEY ไม่ถูกต้อง');
  if (http === 429) fail_('web_img_quota', 'ค้นรูปเกินโควตา Brave (429)');
  if (http !== 200) { console.error('Brave HTTP ' + http + ': ' + res.getContentText().slice(0, 200)); return ''; }
  const results = (parseJson_(res.getContentText(), {}).results || []).slice(0, 6);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    // thumbnail.src = รูปผ่าน proxy ของ Brave (กว้าง ~500px) โหลดได้เสถียรกว่ารูปต้นทาง
    const candidates = [r.thumbnail && r.thumbnail.src, r.properties && r.properties.url].filter(Boolean);
    for (let j = 0; j < candidates.length; j++) {
      const blob = downloadImage_(candidates[j]);
      if (!blob) continue;
      const ext = blob.getContentType().split('/')[1].replace('jpeg', 'jpg');
      const file = webImageFolder_().createFile(blob.setName('z' + z.zortId + '.' + ext));
      file.setDescription('ค้นด้วย: ' + q + '\nจาก: ' + (r.url || r.source || '') + '\n' + (r.title || ''));
      try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { console.error(e.message); }
      return 'https://lh3.googleusercontent.com/d/' + file.getId() + '=w600';
    }
  }
  return '';
}

function downloadImage_(url) {
  if (!/^https:\/\//i.test(String(url))) return null;
  try {
    const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': 'Mozilla/5.0 (rice-order-bot)' } });
    if (r.getResponseCode() !== 200) return null;
    const blob = r.getBlob();
    const type = String(blob.getContentType() || '').split(';')[0];
    const size = blob.getBytes().length;
    if (!/^image\/(jpeg|png|webp)$/.test(type) || size < 3000 || size > 4000000) return null;
    return blob.setContentType(type);
  } catch (e) { return null; }
}

function webSearchEnabled_() {
  const s = getSettings_();
  if (!prop_('BRAVE_SEARCH_API_KEY')) return false;
  return s.WEB_IMAGE_SEARCH === undefined || s.WEB_IMAGE_SEARCH === '' || truthy_(s.WEB_IMAGE_SEARCH);
}

/** (ระหว่างล็อก — เร็ว) ใส่รูปจากเว็บที่เคยค้นเก็บไว้แล้ว */
function applyWebImageCache_(objs, imgStat) {
  if (!webSearchEnabled_()) return;
  let cache = {};
  try { cache = webImageMap_(); } catch (e) { console.error('อ่านโฟลเดอร์รูปจากเว็บไม่ได้: ' + e.message); return; }
  objs.forEach(function (o) {
    const url = !o.image && cache[imgKey_('z' + o.zortId)];
    if (url) { o.image = url; imgStat.none--; imgStat.web++; }
  });
}

/**
 * (หลังปลดล็อก — ช้า) ค้นรูปใหม่ให้สินค้าที่ยังไม่มีรูป แล้วบันทึกทีละแถว
 * แยกออกจากช่วงล็อก เพื่อไม่ให้ลูกค้าสั่งข้าวไม่ได้ระหว่างค้นรูป
 */
function searchMissingWebImages_(imgStat, startedAt) {
  if (!webSearchEnabled_()) return;
  const s = getSettings_();
  const max = Math.max(0, Number(s.WEB_IMAGE_MAX_PER_SYNC === undefined || s.WEB_IMAGE_MAX_PER_SYNC === '' ? 10 : s.WEB_IMAGE_MAX_PER_SYNC) || 0);
  const props = PropertiesService.getScriptProperties();
  const miss = parseJson_(props.getProperty('WEB_IMG_MISS'), {});
  const now = Date.now();
  const todo = readAll_('Products').filter(function (r) {
    const id = String(r.zortId || '').replace(/^'/, '');
    return id && !r.image && !(miss[id] && now - miss[id] < WEB_IMG_RETRY_DAYS * 864e5);
  });
  let searched = 0;
  for (let i = 0; i < todo.length && searched < max; i++) {
    if (Date.now() - startedAt > 240000) break;                               // งบเวลา 4 นาที (Apps Script จำกัด 6 นาที)
    const r = todo[i];
    const id = String(r.zortId).replace(/^'/, '');
    const name = String(r.name || '') + (num_(r.sizeKg) ? ' ' + num_(r.sizeKg) + ' กก.' : '');
    searched++;
    let url = '';
    try { url = fetchWebImage_({ zortId: id, name: name, fullName: name }); } catch (err) {
      console.error('ค้นรูปจากเว็บ: ' + err.message);
      if (/quota|auth/.test(err.code || '')) break;                             // หยุดค้นรอบนี้
      continue;
    }
    if (!url) { miss[id] = now; continue; }
    delete miss[id];
    withLock_(function () {
      const row = findRow_('Products', 'zortId', id);
      if (row && !row.image) updateRow_('Products', row._row, { image: url });
    });
    imgStat.none--; imgStat.web++;
  }
  imgStat.searched = searched;
  props.setProperty('WEB_IMG_MISS', JSON.stringify(miss));
}

/** ทดสอบค้นรูป 1 ชื่อ — แก้ชื่อในฟังก์ชันแล้วกด Run ดูผลใน Execution log */
function testWebImage() {
  const name = 'ข้าวหอมมะลิ ตราฉัตรทอง 5 กก.';
  const url = fetchWebImage_({ zortId: 'test', name: name, fullName: name });
  console.log(url ? '✅ ได้รูป: ' + url + '  (ไฟล์ z_test ในโฟลเดอร์รูปจากเว็บ ลบทิ้งได้)' : '❌ ไม่พบรูป');
}

/** รันเพื่อดูลิงก์โฟลเดอร์รูปสินค้า */
function productImageFolder() {
  console.log('📁 โฟลเดอร์รูปสินค้า: ' + productImageFolder_().getUrl());
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
function syncZortProducts() {
  const startedAt = Date.now();
  const result = withLock_(function () {
    const items = zortFetchRiceProducts_();
    if (!items.length) {
      fail_('zort_empty', 'ดึงจาก ZORT ได้ 0 รายการ จึงยังไม่แก้แท็บ Products — ' + zortDiagnose_());
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

    let driveMap = {};
    try { driveMap = driveImageMap_(); } catch (err) { console.error('อ่านโฟลเดอร์รูปไม่ได้: ' + err.message); }
    const imgStat = { drive: 0, zort: 0, web: 0, none: 0 };

    const now = new Date();
    let nextSort = Object.keys(keep).reduce(function (m, k) { return Math.max(m, num_(keep[k].sort)); }, 0) + 1;
    let added = 0;
    const objs = items.map(function (z) {
      const old = keep[z.zortId];
      if (!old) added++;
      const img = resolveImage_(z, driveMap);
      imgStat[img.from]++;
      return {
        id: 'z' + z.zortId, name: z.name, detail: z.detail, category: z.category, sizeKg: z.sizeKg, unit: z.unit,
        price: z.price, priceWholesale: old ? old.priceWholesale : '', image: img.url, active: z.active,
        sort: old && num_(old.sort) ? num_(old.sort) : nextSort++,
        sku: z.sku, zortId: z.zortId, stock: z.stock, syncedAt: now,
      };
    }).sort(function (a, b) { return a.sort - b.sort; });
    applyWebImageCache_(objs, imgStat);
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
      removed: removed + gone, at: now.toISOString(),
      images: imgStat,
    };
    return result;
  });
  // ค้นรูปจากเว็บหลังปลดล็อก (ลูกค้ายังสั่งข้าวได้ระหว่างนี้)
  try { searchMissingWebImages_(result.images, startedAt); } catch (err) { console.error('ค้นรูปจากเว็บล้มเหลว: ' + err.message); }
  result.images.webSearch = webSearchEnabled_();
  clearCache();
  PropertiesService.getScriptProperties().setProperty('ZORT_LAST_SYNC', JSON.stringify(result));
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
  const folderId = prop_('PRODUCT_IMG_FOLDER_ID');
  return {
    configured: zortConfigured_(),
    pushOrders: zortPushEnabled_(),
    lastSync: parseJson_(prop_('ZORT_LAST_SYNC'), null),
    imageFolderUrl: folderId ? 'https://drive.google.com/drive/folders/' + folderId : '',
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
      ' | รูป: ' + (p.image ? 'มีใน ZORT' : 'ไม่มี — วางไฟล์ชื่อ "' + (p.sku || p.name) + '.jpg" ในโฟลเดอร์รูปสินค้า'));
  });
}
