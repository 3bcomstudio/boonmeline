/**
 * ตั้งค่าหน้าเว็บ — แก้ไฟล์นี้หลัง Deploy Apps Script และสร้าง LIFF แล้ว
 *
 * ถ้า API_URL หรือ LIFF_ID ยังว่าง ระบบจะเปิดใน "โหมดทดลอง"
 * (เก็บข้อมูลในเครื่อง ไม่เชื่อม LINE) เหมาะสำหรับดูหน้าตาและทดสอบ flow
 */
window.APP_CONFIG = {
  // URL ของ Apps Script Web App (ลงท้ายด้วย /exec)
  API_URL: 'https://script.google.com/macros/s/AKfycbx0dYK9Gbz4JyN1v216pGHeRxA3kIoFNkF2eYhWHn0CZ30QOK-sinHO9rfufwUHtwUufA/exec',

  // LIFF ID หน้าลูกค้า (Endpoint URL = https://<github-user>.github.io/<repo>/)
  LIFF_ID: '2012301609-Sm6PAIYY',

  // LIFF ID หน้าแอดมิน (Endpoint URL = .../admin.html) — ถ้าว่างจะใช้ LIFF_ID
  ADMIN_LIFF_ID: '2012301609-L75hvPja',

  // ส่งข้อความสรุปเข้าแชท LINE แทนลูกค้าหลังสั่งซื้อ/ยืนยัน/ส่งสลิป
  // (บอทจะตอบกลับด้วยการ์ดสถานะ — ไม่กินโควตาข้อความ)
  SEND_CHAT_SUMMARY: true,

  // บังคับโหมดทดลอง แม้ตั้งค่าครบแล้ว
  DEMO: false,
};
