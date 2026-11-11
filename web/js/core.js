/* core.js — ส่วนกลางที่หน้าลูกค้าและหน้าแอดมินใช้ร่วมกัน
 * config, ค่าคงที่, จัดรูปแบบ, ไอคอน, เชื่อมต่อ API, LIFF login, toast/modal, PromptPay
 */
(function () {
  'use strict';

  const CFG = Object.assign({ API_URL: '', LIFF_ID: '', ADMIN_LIFF_ID: '', SEND_CHAT_SUMMARY: true, DEMO: false }, window.APP_CONFIG || {});
  const DEMO = !!CFG.DEMO || !CFG.API_URL || !CFG.LIFF_ID;

  /* ---------- ค่าคงที่ ---------- */

  const PURPOSES = [
    { id: 'home', label: 'กินเอง', icon: 'home' },
    { id: 'donate', label: 'ทำบุญ/บริจาค', icon: 'donate', notePrompt: 'ทำบุญที่ไหน หรือให้ใคร (ไม่กรอกก็ได้)' },
    { id: 'restaurant', label: 'ร้านอาหาร', icon: 'restaurant', notePrompt: 'ชื่อร้านอาหาร (ไม่กรอกก็ได้)' },
    { id: 'wholesale', label: 'ขายส่ง/ขายต่อ', icon: 'wholesale', notePrompt: 'ชื่อร้าน หรือกิจการ (ไม่กรอกก็ได้)' },
    { id: 'other', label: 'อื่น ๆ', hint: 'บอกร้านเพิ่มเติมได้', icon: 'other', notePrompt: 'ซื้อข้าวไปใช้ทำอะไร', noteRequired: true },
  ];
  const purposeOf = (id) => PURPOSES.find((p) => p.id === id) || PURPOSES[0];

  /** ข้อความสถานะสำหรับลูกค้า (ภาษาง่าย บอกว่าต้องทำอะไรต่อ) */
  function statusInfo(o) {
    const pickup = o.deliveryMethod === 'pickup';
    const cod = o.payMethod === 'cod';
    switch (o.status) {
      case 'new': return { label: 'รอร้านแจ้งราคา', tone: 'gold', icon: 'clock', next: 'ร้านกำลังคิดราคา แล้วจะส่งมาทาง LINE' };
      case 'quoted': return { label: 'ร้านแจ้งราคาแล้ว', tone: 'blue', icon: 'receipt', next: 'ดูราคา แล้วกดยืนยัน', action: true };
      case 'confirmed':
        return cod
          ? { label: pickup ? 'รอมารับข้าว' : 'รอร้านจัดส่ง', tone: 'blue', icon: 'cash', next: 'เตรียมเงินสด ฿' + money(o.total) + (pickup ? ' ไว้จ่ายตอนมารับข้าว' : ' ไว้จ่ายตอนรับข้าว') }
          : { label: 'รอโอนเงิน', tone: 'gold', icon: 'qr', next: 'สแกน QR จ่ายเงิน แล้วส่งรูปสลิป', action: true };
      case 'slip': return { label: 'ร้านกำลังตรวจสลิป', tone: 'blue', icon: 'clock', next: 'ร้านจะแจ้งทาง LINE เมื่อตรวจเสร็จ' };
      case 'paid': return { label: 'จ่ายเงินแล้ว', tone: 'green', icon: 'check', next: 'ร้านกำลังเตรียมข้าวของคุณ' };
      case 'shipping':
        return pickup
          ? { label: 'ข้าวพร้อมให้มารับ', tone: 'green', icon: 'store', next: 'มารับข้าวที่ร้านได้เลย' }
          : { label: 'กำลังไปส่ง', tone: 'green', icon: 'truck', next: 'ข้าวกำลังเดินทางไปหาคุณ' };
      case 'done': return { label: 'ได้รับข้าวแล้ว', tone: 'green', icon: 'check', next: 'ขอบคุณที่อุดหนุน' };
      case 'cancelled': return { label: 'ยกเลิกแล้ว', tone: 'red', icon: 'x', next: o.cancelReason || '' };
    }
    return { label: o.status, tone: 'blue', icon: 'clock', next: '' };
  }

  /** ป้ายสถานะแบบสั้นสำหรับแอดมิน */
  const ADMIN_STATUS = {
    new: { label: 'รอแจ้งราคา', tone: 'gold' },
    quoted: { label: 'รอลูกค้ายืนยัน', tone: 'blue' },
    confirmed: { label: 'รอชำระ', tone: 'blue' },
    slip: { label: 'ตรวจสลิป', tone: 'gold' },
    paid: { label: 'ชำระแล้ว รอส่ง', tone: 'green' },
    shipping: { label: 'กำลังส่ง', tone: 'green' },
    done: { label: 'สำเร็จ', tone: 'done' },
    cancelled: { label: 'ยกเลิก', tone: 'red' },
  };

  /* ---------- จัดรูปแบบ ---------- */

  function money(n) {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    return v.toLocaleString('th-TH', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }
  function dateTH(iso, withTime) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    const s = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
    return withTime ? s + ' ' + timeTH(iso) : s;
  }
  function timeTH(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.';
  }
  function ago(iso) {
    const ms = Date.now() - new Date(iso).getTime();
    if (!isFinite(ms)) return '';
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'เมื่อสักครู่';
    if (m < 60) return m + ' นาทีที่แล้ว';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' ชม.ที่แล้ว';
    return dateTH(iso, true);
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  /** แยกเบอร์หลายเบอร์ เช่น "086-961-3331, 074-244-690" → ['0869613331', '074244690'] */
  function phoneList(p) {
    return String(p || '').split(/[,;/|]|\s{2,}|และ/).map((x) => x.replace(/[^\d+]/g, '')).filter((x) => x.length >= 9);
  }
  function fmtOne(d) {
    if (d.length === 10) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
    if (d.length === 9 && d.slice(0, 2) === '02') return d.slice(0, 2) + '-' + d.slice(2, 5) + '-' + d.slice(5);
    if (d.length === 9) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
    return d;
  }
  function phoneFmt(p) {
    const list = phoneList(p);
    if (!list.length) return String(p || '').replace(/\D/g, '');
    return list.map(fmtOne).join(', ');
  }
  function mapUrl(lat, lng) { return lat && lng ? 'https://www.google.com/maps?q=' + lat + ',' + lng : ''; }
  function imgUrl(src) { return src || 'assets/rice-placeholder.svg'; }

  /* ---------- ไอคอน (เส้น 2px ปลายมน) ---------- */

  const ICONS = {
    rice: '<path d="M8.5 3h7l-1.3 3.2c3 1.5 5.3 4.6 5.3 8.6 0 3.5-2.6 6.2-6 6.2h-3c-3.4 0-6-2.7-6-6.2 0-4 2.3-7.1 5.3-8.6Z"/><path d="M9.6 6.2h4.8"/><path d="M12 11.2c-1.4 1.2-1.4 3.4 0 4.6 1.4-1.2 1.4-3.4 0-4.6Z"/>',
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 9.8V20h13V9.8"/><path d="M10 20v-5.5h4V20"/>',
    donate: '<path d="M12 20c-4.2 0-8-2.4-9-6 3-.6 6.3.6 9 3.2 2.7-2.6 6-3.8 9-3.2-1 3.6-4.8 6-9 6Z"/><path d="M12 17.2c-2-2.1-2.4-5.3-1.2-8.7L12 6l1.2 2.5c1.2 3.4.8 6.6-1.2 8.7Z"/><path d="M8.6 14.6C6.8 12.8 6.2 10.4 6.6 8.3c1.7.4 3 1.3 3.9 2.5M15.4 14.6c1.8-1.8 2.4-4.2 2-6.3-1.7.4-3 1.3-3.9 2.5"/>',
    restaurant: '<path d="M3 12h18a9 8 0 0 1-18 0Z"/><path d="M8 20.5h8"/><path d="M9 8.5c0-1.5 1.5-1.5 1.5-3M13.5 8.5c0-1.5 1.5-1.5 1.5-3"/>',
    wholesale: '<rect x="3" y="12.5" width="8" height="7.5" rx="1.2"/><rect x="13" y="12.5" width="8" height="7.5" rx="1.2"/><rect x="8" y="4" width="8" height="7.5" rx="1.2"/>',
    other: '<path d="M4 20h4L19.2 8.8a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
    truck: '<path d="M2.5 6h10.5v10H2.5Z"/><path d="M13 9h4.2l3.8 4v3h-8"/><circle cx="6.5" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/>',
    store: '<path d="M4 10.5V20h16v-9.5"/><path d="M2.5 10.5 4.6 4h14.8l2.1 6.5Z"/><path d="M9.5 20v-5h5v5"/>',
    phone: '<path d="M5.2 3.5h3.6l1.8 4.6-2.3 1.4a11.5 11.5 0 0 0 6.2 6.2l1.4-2.3 4.6 1.8v3.6a2 2 0 0 1-2.2 2A17 17 0 0 1 3.2 5.7a2 2 0 0 1 2-2.2Z"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    repeat: '<path d="m17 2.5 3 3-3 3"/><path d="M4 11.5v-2a4 4 0 0 1 4-4h12"/><path d="m7 21.5-3-3 3-3"/><path d="M20 12.5v2a4 4 0 0 1-4 4H4"/>',
    check: '<path d="m4.5 12.5 5 5L19.5 7"/>',
    back: '<path d="m15 4.5-7.5 7.5 7.5 7.5"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    pin: '<path d="M12 21.5s-7-6.2-7-11.7a7 7 0 0 1 14 0c0 5.5-7 11.7-7 11.7Z"/><circle cx="12" cy="9.6" r="2.6"/>',
    camera: '<path d="M3.5 8h3.3l2-3h6.4l2 3h3.3v11.5h-17Z"/><circle cx="12" cy="13.2" r="3.6"/>',
    qr: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h3v3h-3zM17.5 17.5h3v3h-3zM14 20.5h1M20.5 14h.01"/>',
    cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9.5v.01M18 14.5v.01"/>',
    chat: '<path d="M4 4.5h16v11.5H9.5L4 20.5Z"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.3 2"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>',
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
    list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r=".9"/><circle cx="4.8" cy="12" r=".9"/><circle cx="4.8" cy="17.5" r=".9"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-5-5-8.5 8.5"/>',
    external: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13"/><path d="M18 14v5.5H4.5V6H10"/>',
    refresh: '<path d="M20 11A8 8 0 0 0 5.6 6.4L4 8"/><path d="M4 3.5V8h4.5"/><path d="M4 13a8 8 0 0 0 14.4 4.6L20 16"/><path d="M20 20.5V16h-4.5"/>',
    download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
    alert: '<path d="M12 3.5 2.5 20h19Z"/><path d="M12 10v4.5M12 17.5v.01"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.8 1.8H4.2Z"/><path d="M10 21h4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2Z"/><path d="M9 4v14M15 6v14"/>',
    sheet: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/>',
  };
  function icon(name, cls) {
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true" focusable="false"><use href="#i-' + name + '"/></svg>';
  }
  function injectIcons() {
    const sym = Object.keys(ICONS).map((k) =>
      '<symbol id="i-' + k + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[k] + '</symbol>').join('');
    const div = document.createElement('div');
    div.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">' + sym + '</svg>';
    document.body.prepend(div.firstChild);
  }

  /* ---------- LIFF / เข้าสู่ระบบ ---------- */

  let liffReady = false;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('โหลด LINE SDK ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต'));
      document.head.appendChild(s);
    });
  }

  async function initAuth(liffId) {
    if (DEMO) return { demo: true };
    await loadScript('https://static.line-scdn.net/liff/edge/2/sdk.js');
    await window.liff.init({ liffId: liffId });
    liffReady = true;
    if (!window.liff.isLoggedIn()) {
      window.liff.login({ redirectUri: location.href });
      return new Promise(() => {}); // กำลังพาไปหน้า LINE Login
    }
    return { demo: false, inClient: window.liff.isInClient() };
  }

  function relogin() {
    if (DEMO || !liffReady) return;
    const n = Number(sessionStorage.getItem('relogin') || 0);
    if (n > 2) return;
    sessionStorage.setItem('relogin', String(n + 1));
    try { window.liff.logout(); } catch (e) { /* ignore */ }
    window.liff.login({ redirectUri: location.href });
  }

  function inLineApp() { return !DEMO && liffReady && window.liff.isInClient(); }

  function closeWindow() {
    if (inLineApp()) window.liff.closeWindow();
  }

  /** ส่งข้อความเข้าแชทในนามลูกค้า (เฉพาะเปิดในแอป LINE) — บอทจะตอบการ์ดสถานะกลับ */
  async function sendChat(text) {
    if (!CFG.SEND_CHAT_SUMMARY || !inLineApp()) return false;
    try {
      const ctx = window.liff.getContext();
      if (!ctx || ['utou', 'none'].indexOf(ctx.type) < 0) return false;
      await window.liff.sendMessages([{ type: 'text', text: String(text).slice(0, 4900) }]);
      return true;
    } catch (e) { return false; }
  }

  /* ---------- API ---------- */

  class ApiError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  async function api(action, payload) {
    if (DEMO) return window.DemoServer.handle(action, payload || {});
    const body = JSON.stringify(Object.assign({ action: action, idToken: window.liff.getIDToken() }, payload || {}));
    let res;
    try {
      res = await fetch(CFG.API_URL, { method: 'POST', body: body, redirect: 'follow' });
    } catch (e) {
      throw new ApiError('network', 'เชื่อมต่ออินเทอร์เน็ตไม่ได้ กรุณาลองใหม่อีกครั้ง');
    }
    let j;
    try { j = await res.json(); } catch (e) { throw new ApiError('server', 'ระบบของร้านขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง'); }
    if (!j.ok) {
      if (j.code === 'auth_expired' || j.code === 'auth_required') relogin();
      throw new ApiError(j.code, j.error || 'เกิดข้อผิดพลาด');
    }
    sessionStorage.removeItem('relogin');
    return j.data;
  }

  /* ---------- toast / modal / busy ---------- */

  let toastTimer;
  function toast(msg, tone) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    const ic = tone === 'err' ? 'alert' : tone === 'ok' ? 'check' : 'chat';
    el.className = 'toast toast-' + (tone || 'info');
    el.innerHTML = icon(ic) + '<span>' + esc(msg) + '</span>';
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), tone === 'err' ? 5000 : 3200);
  }

  /** modal({title, html, actions:[{label, value, kind}]}) → Promise(value) */
  function modal(opt) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-wrap';
      wrap.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
        (opt.title ? '<h2 id="modal-title" class="modal-title">' + esc(opt.title) + '</h2>' : '') +
        '<div class="modal-body">' + (opt.html || '') + '</div>' +
        '<div class="modal-actions">' +
        (opt.actions || [{ label: 'ตกลง', value: true, kind: 'primary' }]).map((a, i) =>
          '<button type="button" class="btn btn-' + (a.kind || 'ghost') + ' btn-block" data-i="' + i + '">' + esc(a.label) + '</button>').join('') +
        '</div></div>';
      const prevFocus = document.activeElement;
      const close = (v) => {
        wrap.classList.remove('show');
        setTimeout(() => wrap.remove(), 180);
        document.removeEventListener('keydown', onKey);
        if (prevFocus && prevFocus.focus) prevFocus.focus();
        resolve(v);
      };
      const onKey = (e) => { if (e.key === 'Escape') close(null); };
      wrap.addEventListener('click', (e) => {
        const b = e.target.closest('[data-i]');
        if (b) {
          const a = opt.actions[Number(b.dataset.i)];
          if (opt.onAction) { const r = opt.onAction(a.value, wrap); if (r === false) return; }
          close(a.value);
        } else if (e.target === wrap && opt.dismissible !== false) close(null);
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(wrap);
      requestAnimationFrame(() => {
        wrap.classList.add('show');
        const f = wrap.querySelector('input,textarea,select') || wrap.querySelector('.modal-actions .btn');
        if (f) f.focus();
      });
    });
  }

  function confirmBox(title, text, okLabel, cancelLabel, kind) {
    return modal({
      title: title,
      html: text ? '<p>' + esc(text) + '</p>' : '',
      actions: [
        { label: okLabel || 'ตกลง', value: true, kind: kind || 'primary' },
        { label: cancelLabel || 'ยกเลิก', value: false, kind: 'ghost' },
      ],
    });
  }

  function busy(on, text) {
    let el = document.getElementById('busy');
    if (!on) { if (el) el.classList.remove('show'); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'busy'; el.className = 'busy'; el.setAttribute('role', 'alert');
      document.body.appendChild(el);
    }
    el.innerHTML = '<div class="busy-box">' + sackLoader('4.2rem') + '<span class="loading-text">' + esc(text || 'กำลังทำงาน...') + '</span></div>';
    el.classList.add('show');
  }

  /* ---------- ภาพตอนโหลด: เมล็ดข้าวร่วงลงกระสอบ (SVG + CSS ไม่ต้องโหลดไฟล์เพิ่ม) ---------- */
  let sackSeq = 0;
  function sackLoader(size) {
    const id = 'sk' + (++sackSeq);
    const body = 'M30 40C25 60 23 82 25 104C26 116 23 124 18 130C34 126 46 128 60 128S86 126 102 130C97 124 94 116 95 104C97 82 95 60 90 40Z';
    const grains = [[50, 0, -20], [66, .32, 25], [57, .64, -5], [70, .96, 40], [46, 1.28, 10]].map((g) =>
      '<ellipse cx="' + g[0] + '" cy="4" rx="2.6" ry="4.3" style="animation-delay:' + g[1] + 's;--r:' + g[2] + 'deg"/>').join('');
    return '<span class="sack-loader" style="--sl:' + (size || '8rem') + '" aria-hidden="true"><svg viewBox="0 0 120 140" focusable="false">' +
      '<defs>' +
      '<linearGradient id="' + id + 'b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FBF0D2"/><stop offset=".55" stop-color="#EBCF8D"/><stop offset="1" stop-color="#C9973B"/></linearGradient>' +
      '<linearGradient id="' + id + 'c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F6E3AE"/><stop offset="1" stop-color="#D6AE5C"/></linearGradient>' +
      '<linearGradient id="' + id + 's" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
      '<radialGradient id="' + id + 'h"><stop offset="0" stop-color="#F3D46E" stop-opacity=".6"/><stop offset="1" stop-color="#F3D46E" stop-opacity="0"/></radialGradient>' +
      '<pattern id="' + id + 'w" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 .5H4M.5 0V4" stroke="#A97B2C" stroke-width=".6" opacity=".22"/></pattern>' +
      '<clipPath id="' + id + 'k"><path d="' + body + '"/></clipPath>' +
      '</defs>' +
      '<circle class="sl-halo" cx="60" cy="80" r="60" fill="url(#' + id + 'h)"/>' +
      '<ellipse class="sl-shadow" cx="60" cy="131" rx="42" ry="5"/>' +
      '<g class="sl-grains">' + grains + '</g>' +
      '<g class="sl-sack">' +
      '<path d="' + body + '" fill="url(#' + id + 'b)" stroke="#B88A33" stroke-width="1.5"/>' +
      '<g clip-path="url(#' + id + 'k)">' +
      '<rect x="0" y="0" width="120" height="140" fill="url(#' + id + 'w)"/>' +
      '<rect x="0" y="56" width="120" height="9" fill="#12672F"/><rect x="0" y="66.5" width="120" height="1.6" fill="#D9A521"/>' +
      '<rect class="sl-shine" x="-30" y="20" width="26" height="120" fill="url(#' + id + 's)"/></g>' +
      '<path d="M27 118C46 123 74 123 93 118" fill="none" stroke="#B88A33" stroke-width="1.2" stroke-dasharray="3 3" opacity=".7"/>' +
      '<text x="60" y="98" text-anchor="middle" font-size="16" font-weight="700" fill="#12672F">ข้าว</text>' +
      '<path d="M29 30C29 23 91 23 91 30L90 42C76 37 44 37 30 42Z" fill="url(#' + id + 'c)" stroke="#B88A33" stroke-width="1.5"/>' +
      '<ellipse cx="60" cy="30" rx="29" ry="6" fill="#7A5420"/>' +
      '<ellipse class="sl-heap" cx="60" cy="31.5" rx="24" ry="3.8" fill="#FFF8E7"/>' +
      '</g></svg></span>';
  }

  /* ---------- PromptPay QR (มาตรฐาน EMVCo) ---------- */

  function crc16(s) {
    let crc = 0xffff;
    for (let i = 0; i < s.length; i++) {
      crc ^= s.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }
  function promptpayPayload(id, amount) {
    const f = (tag, v) => tag + String(v.length).padStart(2, '0') + v;
    const d = String(id || '').replace(/\D/g, '');
    if (d.length < 10) return '';
    let target;
    if (d.length >= 15) target = f('03', d);
    else if (d.length === 13) target = f('02', d);
    else target = f('01', ('0000000000000' + d.replace(/^0/, '66')).slice(-13));
    const amt = Number(amount) > 0 ? f('54', Number(amount).toFixed(2)) : '';
    const body = f('00', '01') + f('01', amt ? '12' : '11') + f('29', f('00', 'A000000677010111') + target) +
      f('53', '764') + amt + f('58', 'TH') + '6304';
    return body + crc16(body);
  }
  function qrDataUrl(text, cell) {
    if (!text || typeof window.qrcode !== 'function') return '';
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createDataURL(cell || 8, 4);
  }

  /* ---------- รูปภาพ (ย่อก่อนอัปโหลด) ---------- */

  function resizeImage(file, maxSide, quality) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, (maxSide || 1400) / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', quality || 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดรูปนี้ไม่ได้ กรุณาเลือกรูปอื่น')); };
      img.src = url;
    });
  }

  /* ---------- Geolocation ---------- */

  function getLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('เครื่องนี้หาตำแหน่งไม่ได้ กรุณาพิมพ์ที่อยู่แทน'));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6 }),
        (e) => reject(new Error(e.code === 1
          ? 'ยังไม่ได้อนุญาตให้ใช้ตำแหน่ง กรุณากดอนุญาต หรือพิมพ์ที่อยู่แทน'
          : 'หาตำแหน่งไม่สำเร็จ กรุณาลองใหม่ หรือพิมพ์ที่อยู่แทน')),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    });
  }

  function storage(key, val) {
    try {
      if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
      if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
    return val;
  }

  window.Rice = {
    CFG, DEMO, PURPOSES, purposeOf, statusInfo, ADMIN_STATUS,
    money, dateTH, timeTH, ago, esc, phoneFmt, phoneList, mapUrl, imgUrl,
    icon, injectIcons, sackLoader, initAuth, relogin, inLineApp, closeWindow, sendChat,
    api, ApiError, toast, modal, confirmBox, busy,
    promptpayPayload, qrDataUrl, resizeImage, getLocation, storage,
  };
})();
