/**
 * Setup.gs — ติดตั้งระบบครั้งแรก และเครื่องมือช่วยตรวจสอบ
 *
 * วิธีใช้: ในหน้า Apps Script เลือกฟังก์ชัน setup แล้วกด Run (อนุญาตสิทธิ์ครั้งแรก)
 * ดูผลลัพธ์ที่ Execution log
 */

const DEFAULT_SETTINGS = [
  ['SHOP_NAME', 'ร้านข้าวหอม', 'ชื่อร้าน แสดงบนหน้าเว็บและข้อความ LINE'],
  ['SHOP_PHONE', '0812345678', 'เบอร์โทรร้าน (ปุ่ม "โทรหาร้าน")'],
  ['SHOP_ADDRESS', '', 'ที่อยู่ร้าน สำหรับลูกค้าที่มารับเอง'],
  ['SHOP_HOURS', 'ทุกวัน 08:00–18:00', 'เวลาทำการ'],
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
];

/** ราคาตัวอย่างเท่านั้น — แก้ในแท็บ Products ให้ตรงกับราคาจริงของร้าน */
const DEFAULT_PRODUCTS = [
  ['p01', 'ตราฉัตรทอง', 'ข้าวหอมมะลิแท้ 100%', 5, 'ถุง', 245, 225, 'assets/products/chatthong.jpg', true, 1],
  ['p02', 'ตราหงษ์ทอง', 'ข้าวหอมมะลิ 100%', 5, 'ถุง', 240, 220, 'assets/products/hongthong.jpg', true, 2],
  ['p03', 'มาบุญครอง', 'ข้าวหอมมะลิ 100%', 5, 'ถุง', 230, 210, 'assets/products/mahboonkrong.jpg', true, 3],
  ['p04', 'ตราเบญจรงค์', 'ข้าวขาวหอมมะลิ ชาววัง', 5, 'ถุง', 255, 235, 'assets/products/benjarong.jpg', true, 4],
  ['p05', 'ตราพนมรุ้ง', 'ข้าวขาวหอมมะลิ 100%', 5, 'ถุง', 225, 205, 'assets/products/phanomrung.jpg', true, 5],
  ['p06', 'ตราปิ่นเงิน', 'ข้าวขาวหอมมะลิ 100%', 5, 'ถุง', 215, 195, 'assets/products/pinngoen.jpg', true, 6],
  ['p07', 'ตราแสนดี', 'ข้าวขาวหอมมะลิแท้ 100%', 5, 'ถุง', 210, 190, 'assets/products/saendee.jpg', true, 7],
  ['p08', 'ตราธรรม', 'ข้าวหอมใหม่ คัดพิเศษ', 5, 'ถุง', 220, 200, 'assets/products/tham.jpg', true, 8],
  ['p09', 'ตราไดโนเสาร์', 'ข้าวหอมมะลิ 100%', 15, 'กระสอบ', 590, 550, 'assets/products/dinosaur.jpg', true, 9],
  ['p10', 'ตราเพชร 101', 'ข้าวหอมมะลิแท้ 100% ทุ่งกุลาร้องไห้', 15, 'กระสอบ', 650, 610, 'assets/products/diamond101.jpg', true, 10],
];

function setup() {
  const props = PropertiesService.getScriptProperties();
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    const id = props.getProperty('SPREADSHEET_ID');
    ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create('ระบบสั่งข้าวสาร LINE OA');
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

  // Products
  const prodSh = ss.getSheetByName('Products');
  if (prodSh.getLastRow() < 2) {
    prodSh.getRange(2, 1, DEFAULT_PRODUCTS.length, DEFAULT_PRODUCTS[0].length).setValues(DEFAULT_PRODUCTS);
  }

  if (!props.getProperty('ADMIN_SETUP_CODE')) {
    props.setProperty('ADMIN_SETUP_CODE', String(Math.floor(100000 + Math.random() * 900000)));
  }
  slipFolder_();
  clearCache();

  console.log('✅ ติดตั้งเรียบร้อย: ' + ss.getUrl());
  console.log('🔑 รหัสลงทะเบียนแอดมิน (ADMIN_SETUP_CODE): ' + props.getProperty('ADMIN_SETUP_CODE'));
  checkConfig();
}

function ensureSheet_(ss, name, cols) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const lastCol = sh.getLastColumn();
  const current = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  const missing = cols.filter(function (c) { return current.indexOf(c) < 0; });
  if (missing.length) sh.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
  const width = sh.getLastColumn();
  sh.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#1B3A7A').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  if (name === 'Orders') sh.setFrozenColumns(1);
}

/** ตรวจว่าตั้งค่า Script Properties ครบหรือยัง */
function checkConfig() {
  const need = {
    LINE_CHANNEL_ACCESS_TOKEN: 'Messaging API → Channel access token (long-lived)',
    LOGIN_CHANNEL_ID: 'LINE Login channel → Channel ID',
    LIFF_ID: 'LIFF ID ของหน้าลูกค้า',
    ADMIN_URL: '(ไม่บังคับ) ลิงก์หน้าแอดมิน เช่น https://liff.line.me/<ADMIN_LIFF_ID>',
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
