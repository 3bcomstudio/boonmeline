/**
 * Setup.gs — ติดตั้งระบบครั้งแรก และเครื่องมือช่วยตรวจสอบ
 *
 * วิธีใช้: ในหน้า Apps Script เลือกฟังก์ชัน setup แล้วกด Run (อนุญาตสิทธิ์ครั้งแรก)
 * ดูผลลัพธ์ที่ Execution log
 */

const DEFAULT_SETTINGS = [
  ['SHOP_NAME', 'หจก.บุญมีหาดใหญ่', 'ชื่อร้าน แสดงบนหน้าเว็บและข้อความ LINE'],
  ['LOGO_URL', 'https://3bcomstudio.github.io/boonmeline/assets/logo.png', 'ลิงก์รูปโลโก้ร้าน (https) แสดงในข้อความต้อนรับใน LINE — เว้นว่างถ้าไม่ต้องการ'],
  ['SHOP_PHONE', '086-961-3331, 074-244-690', 'เบอร์โทรร้าน — หลายเบอร์คั่นด้วย , (ปุ่ม "โทรหาร้าน" โทรเบอร์แรก)'],
  ['SHOP_ADDRESS', '51 ถนนเชื่อมรัฐ ตำบลหาดใหญ่ อำเภอหาดใหญ่ สงขลา 90110', 'ที่อยู่ร้าน แสดงในหน้าแรก ท้ายหน้า และสำหรับลูกค้าที่มารับเอง'],
  ['SHOP_HOURS', 'วันจันทร์–วันเสาร์ 8.00–17.00 น.', 'เวลาทำการ'],
  ['SHOP_TAX_ID', '', 'เลขทะเบียนนิติบุคคล / เลขผู้เสียภาษี 13 หลัก (แสดงที่หน้าแรกและท้ายหน้า ให้ลูกค้ามั่นใจว่าเป็นร้านจริง)'],
  ['SHOP_LAT', '', 'ละติจูดร้าน (ใช้คำนวณระยะทาง) เช่น 7.0086'],
  ['SHOP_LNG', '', 'ลองจิจูดร้าน เช่น 100.4747'],
  ['QUOTE_TIME', 'ภายใน 1 ชั่วโมงในเวลาทำการ', 'บอกลูกค้าว่าจะได้ราคาเมื่อไร'],
  ['PROMPTPAY_ID', '', 'เบอร์มือถือ / เลขบัตรประชาชน / เลขผู้เสียภาษี ที่ผูกพร้อมเพย์ (สร้าง QR อัตโนมัติ)'],
  ['PROMPTPAY_NAME', '', 'ชื่อบัญชีพร้อมเพย์ ให้ลูกค้าตรวจสอบก่อนโอน'],
  ['BANK_INFO', '', 'ข้อมูลบัญชีธนาคารเพิ่มเติม เช่น กสิกรไทย 123-4-56789-0 ชื่อ ...'],
  ['ALLOW_COD', 'TRUE', 'TRUE = รับเงินสดตอนส่ง/ตอนมารับ'],
  ['SHIP_BASE', '0', 'ค่าส่งเริ่มต้น (บาท) — ใช้เป็นค่าแนะนำในหน้าแอดมิน'],
  ['SHIP_PER_KM', '0', 'ค่าส่งต่อกิโลเมตร (บาท) — ใช้เป็นค่าแนะนำ'],
  ['FREE_SHIP_BAGS', '0', 'ส่งฟรีเมื่อสั่งครบกี่ถุง (0 = ไม่ใช้)'],
  ['ADMIN_NOTIFY', 'TRUE', 'TRUE = แจ้งเตือนแอดมินทาง LINE เมื่อมีคำสั่งซื้อใหม่ (ใช้โควตาข้อความ)'],
  ['ZORT_WAREHOUSE_CODE', '', 'ZORT: รหัสคลังที่ใช้ดูสต็อก (ว่าง = รวมทุกคลัง)'],
  ['ZORT_PUSH_ORDERS', 'TRUE', 'ZORT: TRUE = เมื่อปิดการขาย (ได้รับข้าวแล้ว) บันทึกยอดขายเข้า ZORT อัตโนมัติ'],
  ['ZORT_SALES_CHANNEL', 'LINE OA', 'ZORT: ชื่อช่องทางการขายที่บันทึกในคำสั่งซื้อ'],
  ['ZORT_ORDER_VATTYPE', '1', 'ZORT: 1 = ไม่มี VAT (ข้าวสารได้รับยกเว้น VAT) / 2 = แยก VAT / 3 = รวม VAT'],
  ['ZORT_PAYMENT_TRANSFER', 'โอนเงิน', 'ZORT: ชื่อวิธีชำระเงินเมื่อลูกค้าโอน (ให้ตรงกับที่ตั้งไว้ใน ZORT)'],
  ['ZORT_PAYMENT_CASH', 'เงินสด', 'ZORT: ชื่อวิธีชำระเงินเมื่อจ่ายเงินสด (ให้ตรงกับที่ตั้งไว้ใน ZORT)'],
];

function setup() {
  const props = PropertiesService.getScriptProperties();
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    const id = props.getProperty('SPREADSHEET_ID');
    ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create('ระบบสั่งข้าว หจก.บุญมีหาดใหญ่');
  }
  props.setProperty('SPREADSHEET_ID', ss.getId());
  SS_CACHE_ = ss;
  ss.setSpreadsheetTimeZone(TZ);

  Object.keys(SCHEMA).forEach(function (name) { ensureSheet_(ss, name, SCHEMA[name]); });
  const blank = ss.getSheetByName('Sheet1') || ss.getSheetByName('แผ่น1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  // Settings
  const settingsSh = ss.getSheetByName('Settings');
  const have = {};
  readAll_('Settings').forEach(function (r) { have[r.key] = true; });
  DEFAULT_SETTINGS.filter(function (r) { return !have[r[0]]; }).forEach(function (r) {
    settingsSh.appendRow([r[0], cellValue_(r[1]), r[2]]);
  });
  fixShopName();
  fixShopInfo();

  // Products — ไม่มีข้าวตั้งต้น ข้อมูลข้าวมาจาก ZORT เท่านั้น (รัน syncZortProducts หลังตั้งค่า ZORT)

  if (!props.getProperty('ADMIN_SETUP_CODE')) {
    props.setProperty('ADMIN_SETUP_CODE', String(Math.floor(100000 + Math.random() * 900000)));
  }
  slipFolder_();
  clearCache();

  console.log('✅ ติดตั้งเรียบร้อย: ' + ss.getUrl());
  console.log('🔑 รหัสลงทะเบียนแอดมิน (ADMIN_SETUP_CODE): ' + props.getProperty('ADMIN_SETUP_CODE'));
  checkConfig();
  if (zortConfigured_()) {
    try { syncZortProducts(); console.log('✅ ดึงข้าวจาก ZORT แล้ว'); } catch (err) { console.log('⚠️  ดึงข้าวจาก ZORT ไม่สำเร็จ: ' + err.message); }
  } else {
    console.log('⚠️  ยังไม่มีข้าวในระบบ — ตั้งค่า ZORT_STORENAME / ZORT_APIKEY / ZORT_APISECRET แล้วรัน syncZortProducts');
  }
}

function ensureSheet_(ss, name, cols) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const lastCol = sh.getLastColumn();
  const current = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  const missing = cols.filter(function (c) { return current.indexOf(c) < 0; });
  if (missing.length) sh.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
  const width = sh.getLastColumn();
  sh.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#12672F').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  if (name === 'Orders') sh.setFrozenColumns(1);
}

/**
 * เปลี่ยนชื่อร้านเดิม "ร้านข้าวหอม" (ค่าตั้งต้นเวอร์ชันแรก) เป็น "หจก.บุญมีหาดใหญ่" ในแท็บ Settings
 * รันเดี่ยว ๆ ได้ หรือรันผ่าน setup() — ค่าที่ร้านตั้งเป็นชื่ออื่นแล้วจะไม่ถูกแตะ
 */
const OLD_SHOP_NAME = 'ร้านข้าวหอม';
const NEW_SHOP_NAME = 'หจก.บุญมีหาดใหญ่';

/**
 * แทนค่าตัวอย่างจากเวอร์ชันแรกด้วยข้อมูลร้านจริง — แตะเฉพาะช่องที่ยังเป็นค่าตัวอย่างหรือว่าง
 * (ถ้าร้านแก้เป็นค่าอื่นเองแล้วจะไม่ถูกทับ)
 */
const SHOP_INFO_DEFAULTS = {
  SHOP_PHONE: { old: ['', '0812345678', '812345678'], value: '086-961-3331, 074-244-690' },
  SHOP_ADDRESS: { old: [''], value: '51 ถนนเชื่อมรัฐ ตำบลหาดใหญ่ อำเภอหาดใหญ่ สงขลา 90110' },
  SHOP_HOURS: { old: ['', 'ทุกวัน 08:00–18:00'], value: 'วันจันทร์–วันเสาร์ 8.00–17.00 น.' },
};

function needsShopInfo_(s) {
  return Object.keys(SHOP_INFO_DEFAULTS).some(function (k) {
    return Object.prototype.hasOwnProperty.call(s, k) && SHOP_INFO_DEFAULTS[k].old.indexOf(String(s[k]).trim()) >= 0;
  });
}

function fixShopInfo() {
  let n = 0;
  readAll_('Settings').forEach(function (r) {
    const d = SHOP_INFO_DEFAULTS[String(r.key).trim()];
    if (d && d.old.indexOf(String(r.value).trim()) >= 0) {
      updateRow_('Settings', r._row, { value: d.value });
      console.log('✏️  ' + r.key + ' → ' + d.value);
      n++;
    }
  });
  clearCache();
  console.log(n ? '✅ อัปเดตข้อมูลร้าน ' + n + ' ค่า' : 'ข้อมูลร้านเป็นค่าจริงอยู่แล้ว');
}

function fixShopName() {
  let n = 0;
  readAll_('Settings').forEach(function (r) {
    const v = String(r.value || '');
    if (v.indexOf(OLD_SHOP_NAME) >= 0) {
      updateRow_('Settings', r._row, { value: v.split(OLD_SHOP_NAME).join(NEW_SHOP_NAME) });
      console.log('✏️  ' + r.key + ': "' + v + '" → "' + v.split(OLD_SHOP_NAME).join(NEW_SHOP_NAME) + '"');
      n++;
    }
  });
  const ss = ss_();
  if (ss.getName().indexOf(OLD_SHOP_NAME) >= 0) ss.rename(ss.getName().split(OLD_SHOP_NAME).join(NEW_SHOP_NAME));
  clearCache();
  console.log(n ? '✅ เปลี่ยนชื่อร้านแล้ว ' + n + ' ค่า' : 'ไม่พบชื่อ "' + OLD_SHOP_NAME + '" ในแท็บ Settings');
}

/** ตรวจว่าตั้งค่า Script Properties ครบหรือยัง */
function checkConfig() {
  const need = {
    LINE_CHANNEL_ACCESS_TOKEN: 'Messaging API → Channel access token (long-lived)',
    LOGIN_CHANNEL_ID: 'LINE Login channel → Channel ID',
    LIFF_ID: 'LIFF ID ของหน้าลูกค้า',
    ADMIN_URL: '(ไม่บังคับ) ลิงก์หน้าแอดมิน เช่น https://liff.line.me/<ADMIN_LIFF_ID>',
    ZORT_STORENAME: '(ไม่บังคับ) ZORT → storename',
    ZORT_APIKEY: '(ไม่บังคับ) ZORT → API Key',
    ZORT_APISECRET: '(ไม่บังคับ) ZORT → API Secret',
  };
  Object.keys(need).forEach(function (k) {
    console.log((prop_(k) ? '✅ ' : '⚠️  ยังไม่ตั้ง ') + k + ' — ' + need[k]);
  });
  const url = ScriptApp.getService().getUrl();
  console.log(url ? '🌐 Web App URL: ' + url : '⚠️  ยังไม่ได้ Deploy เป็น Web App');
}

/** ทดสอบส่งข้อความหาแอดมินทุกคน */
function testNotifyAdmins() {
  const r = lineApi_('multicast', {
    to: admins_().map(function (a) { return a.userId; }),
    messages: [{ type: 'text', text: '✅ ทดสอบ: ระบบสั่งข้าวส่งข้อความหาแอดมินได้แล้ว' }],
  });
  console.log(JSON.stringify(r));
}
