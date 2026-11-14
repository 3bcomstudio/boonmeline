/**
 * Line.gs — ส่งข้อความ LINE (Messaging API), สร้าง Flex Message และรับ webhook
 *
 * โควตาข้อความ: push / multicast นับโควตารายเดือนของ LINE OA
 *               reply (ตอบกลับทันทีจาก webhook) ไม่นับโควตา
 */

const C = {
  brand: '#12672F', ink: '#142519', ink2: '#34483A', ink3: '#56685A',
  gold: '#D9A521', goldDark: '#765000', green: '#17803D', red: '#B3261E', line: '#E3DDC8',
};

/* ---------------- Messaging API ---------------- */

function lineApi_(path, payload) {
  const token = prop_('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) return { ok: false, error: 'ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN' };
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/' + path, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code === 200) return { ok: true };
  const j = parseJson_(res.getContentText(), {});
  const msg = 'LINE ' + code + ': ' + (j.message || res.getContentText()) + (j.details ? ' ' + JSON.stringify(j.details) : '');
  console.warn(path, msg);
  return { ok: false, error: msg };
}

function pushToUser_(to, messages) {
  if (!to) return { ok: false, error: 'ไม่มี userId' };
  return lineApi_('push', { to: to, messages: messages });
}

function reply_(replyToken, messages) {
  if (!replyToken) return { ok: false };
  return lineApi_('reply', { replyToken: replyToken, messages: messages });
}

function notifyAdmins_(messages) {
  if (!truthy_(getSettings_().ADMIN_NOTIFY)) return { ok: false, skipped: true };
  const ids = admins_().filter(function (a) { return truthy_(a.notify); }).map(function (a) { return a.userId; });
  if (!ids.length) return { ok: false, skipped: true };
  return lineApi_('multicast', { to: ids.slice(0, 500), messages: messages });
}

/* ---------------- Links ---------------- */

function liffUrl_(orderId) {
  const id = prop_('LIFF_ID');
  if (!id) return '';
  return 'https://liff.line.me/' + id + (orderId ? '?order=' + encodeURIComponent(orderId) : '');
}

function adminUrl_(orderId) {
  const base = prop_('ADMIN_URL');
  if (!base) return '';
  return base + (orderId ? (base.indexOf('?') >= 0 ? '&' : '?') + 'order=' + encodeURIComponent(orderId) : '');
}

/** ลิงก์โทร — ถ้ามีหลายเบอร์ (คั่นด้วย ,) ใช้เบอร์แรก */
function telUri_(phone) {
  const d = String(phone || '').split(/[,;/|]|และ/)[0].replace(/[^\d+]/g, '');
  return d.length >= 9 ? 'tel:' + d : '';
}

function mapUrl_(lat, lng) {
  return lat && lng ? 'https://www.google.com/maps?q=' + lat + ',' + lng : '';
}

/* ---------------- Flex building blocks ---------------- */

function t_(text, opt) {
  const s = String(text === null || text === undefined ? '' : text).trim();
  return Object.assign({ type: 'text', text: s || '-', wrap: true, color: C.ink, size: 'md' }, opt || {});
}

function kv_(label, value, opt) {
  opt = opt || {};
  return {
    type: 'box', layout: 'horizontal', spacing: 'md', margin: opt.margin || 'sm',
    contents: [
      t_(label, { size: opt.size || 'md', color: C.ink3, flex: opt.lf || 3 }),
      t_(value, { size: opt.size || 'md', color: opt.color || C.ink, weight: opt.weight || 'regular', align: 'end', flex: opt.rf || 5 }),
    ],
  };
}

function btn_(label, uri, style, color) {
  if (!uri) return null;
  return { type: 'button', style: style || 'primary', color: style === 'secondary' ? undefined : (color || C.brand), height: 'md', action: { type: 'uri', label: label, uri: uri } };
}

function bubble_(o) {
  const b = {
    type: 'bubble', size: 'mega',
    hero: o.hero ? { type: 'image', url: o.hero, size: 'md', aspectRatio: '1:1', aspectMode: 'fit', backgroundColor: '#FFFFFF' } : undefined,
    header: {
      type: 'box', layout: 'vertical', paddingAll: '18px', backgroundColor: o.headerBg || C.brand,
      contents: [t_(o.title, { color: o.headerColor || '#FFFFFF', size: 'xl', weight: 'bold' })]
        .concat(o.subtitle ? [t_(o.subtitle, { color: o.subColor || '#E9EEF8', size: 'md', margin: 'xs' })] : []),
    },
    body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '18px', contents: o.body },
  };
  const buttons = (o.buttons || []).filter(Boolean).map(function (x) {
    if (!x.color) delete x.color;
    return x;
  });
  if (!b.hero) delete b.hero;
  if (buttons.length) b.footer = { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px', contents: buttons };
  return b;
}

function flex_(altText, bubble) {
  return { type: 'flex', altText: String(altText).slice(0, 380), contents: bubble };
}

function shopName_(s) { return String(s.SHOP_NAME || 'หจก.บุญมีหาดใหญ่'); }

/* ---------------- Customer messages ---------------- */

function flexWelcome_(s) {
  return flex_('ยินดีต้อนรับสู่ ' + shopName_(s) + ' — กดปุ่ม "สั่งข้าวสาร" เพื่อเริ่มสั่ง', bubble_({
    title: 'ยินดีต้อนรับ',
    subtitle: shopName_(s),
    hero: /^https:\/\//.test(String(s.LOGO_URL || '')) ? String(s.LOGO_URL) : '',
    body: [
      t_('สั่งข้าวสารง่าย ๆ ใน 3 ขั้นตอน', { weight: 'bold', size: 'lg' }),
      t_('1. เลือกข้าวและจำนวนถุง', { margin: 'md' }),
      t_('2. ร้านคิดราคาแล้วส่งมาในแชทนี้'),
      t_('3. กดยืนยัน แล้วจ่ายเงิน'),
    ].concat(s.SHOP_HOURS ? [t_('เวลาทำการ ' + s.SHOP_HOURS, { size: 'sm', color: C.ink3, margin: 'lg' })] : []),
    buttons: [
      btn_('สั่งข้าวสาร', liffUrl_()),
      btn_('โทรหาร้าน', telUri_(s.SHOP_PHONE), 'secondary'),
    ],
  }));
}

function flexQuote_(o, s) {
  const q = o.quote || { lines: [], subtotal: 0, shippingFee: 0, discount: 0, total: o.total };
  const body = [t_('รายการข้าว', { weight: 'bold', color: C.brand })];
  q.lines.forEach(function (l) {
    body.push({
      type: 'box', layout: 'vertical', margin: 'md',
      contents: [
        t_(l.name + (l.sizeKg ? ' ' + l.sizeKg + ' กก.' : ''), { weight: 'bold', size: 'lg' }),
        kv_(l.qty + ' ' + l.unit + ' × ฿' + money_(l.unitPrice), '฿' + money_(l.amount), { lf: 5, rf: 3, margin: 'none' }),
      ],
    });
  });
  body.push({ type: 'separator', margin: 'lg', color: C.line });
  body.push(kv_('ค่าข้าว', '฿' + money_(q.subtotal), { margin: 'lg' }));
  body.push(kv_(o.deliveryMethod === 'pickup' ? 'รับที่ร้าน' : 'ค่าส่ง', q.shippingFee > 0 ? '฿' + money_(q.shippingFee) : 'ไม่มีค่าส่ง'));
  if (q.discount > 0) body.push(kv_('ส่วนลด', '−฿' + money_(q.discount), { color: C.green }));
  body.push({ type: 'separator', margin: 'lg', color: C.line });
  body.push({
    type: 'box', layout: 'horizontal', margin: 'lg',
    contents: [
      t_('ยอดที่ต้องจ่าย', { weight: 'bold', size: 'lg', gravity: 'center', flex: 4 }),
      t_('฿' + money_(q.total), { weight: 'bold', size: 'xxl', color: C.brand, align: 'end', flex: 5 }),
    ],
  });
  if (q.note) body.push(t_('ข้อความจากร้าน: ' + q.note, { size: 'md', color: C.ink2, margin: 'lg' }));
  body.push(t_('กดปุ่มด้านล่าง เพื่อยืนยันและเลือกวิธีจ่ายเงิน', { size: 'sm', color: C.ink3, margin: 'lg' }));
  body.push(t_('โอนเข้าบัญชีชื่อ "' + String(s.PROMPTPAY_NAME || shopName_(s)) + '" เท่านั้น · ร้านไม่ขอรหัส OTP หรือรหัสผ่านธนาคาร', { size: 'xs', color: C.ink3, margin: 'md' }));

  return flex_('ร้านแจ้งราคา #' + o.orderId + ' ยอด ฿' + money_(q.total) + ' — กดเพื่อยืนยัน', bubble_({
    title: 'ร้านแจ้งราคาแล้ว',
    subtitle: 'ใบสั่งสินค้า เลขที่ ' + o.orderId,
    body: body,
    buttons: [
      btn_('ดูราคาและยืนยัน', liffUrl_(o.orderId), 'primary', C.green),
      btn_('โทรถามร้าน', telUri_(s.SHOP_PHONE), 'secondary'),
    ],
  }));
}

function statusCopy_(o, s, from) {
  const total = '฿' + money_(o.total);
  const pickup = o.deliveryMethod === 'pickup';
  switch (o.status) {
    case 'new':
      return { title: 'ร้านได้รับใบสั่งสินค้าแล้ว', text: 'ร้านกำลังคิดราคา แล้วจะส่งราคามาในแชทนี้' + (s.QUOTE_TIME ? ' (' + s.QUOTE_TIME + ')' : ''), bg: C.brand, btn: 'ดูใบสั่งสินค้า' };
    case 'quoted':
      return { title: 'ร้านแจ้งราคาแล้ว', text: 'ยอดที่ต้องจ่าย ' + total + ' กดปุ่มเพื่อดูราคาและยืนยัน', bg: C.brand, btn: 'ดูราคาและยืนยัน' };
    case 'confirmed':
      if (from === 'slip') return { title: 'ขอรูปสลิปใหม่อีกครั้ง', text: 'ร้านตรวจสลิปแล้วยังไม่ตรงกับยอดเงิน กรุณาส่งรูปสลิปใหม่', bg: C.red, btn: 'ส่งสลิปใหม่' };
      if (o.payMethod === 'cod') return { title: 'ยืนยันสั่งข้าวแล้ว', text: 'เตรียมเงินสด ' + total + (pickup ? ' ไว้จ่ายตอนมารับข้าวที่ร้าน' : ' ไว้จ่ายตอนรับข้าว'), bg: C.brand, btn: 'ดูใบสั่งสินค้า' };
      return { title: 'ยืนยันสั่งข้าวแล้ว', text: 'ยอดที่ต้องจ่าย ' + total + ' กดปุ่มเพื่อดู QR พร้อมเพย์และส่งรูปสลิป', bg: C.brand, btn: 'จ่ายเงินและส่งสลิป' };
    case 'slip':
      return { title: 'ร้านได้รับสลิปแล้ว', text: 'ร้านกำลังตรวจสอบยอดเงิน แล้วจะแจ้งให้ทราบในแชทนี้', bg: C.brand, btn: 'ดูใบสั่งสินค้า' };
    case 'paid':
      return { title: 'ได้รับเงินแล้ว ขอบคุณที่อุดหนุน', text: 'ร้านกำลังเตรียมข้าวของคุณ', bg: C.green, btn: 'ดูใบสั่งสินค้า' };
    case 'shipping':
      return pickup
        ? { title: 'ข้าวพร้อมแล้ว มารับได้เลย', text: 'มารับที่ร้าน' + (s.SHOP_ADDRESS ? ': ' + s.SHOP_ADDRESS : ''), bg: C.green, btn: 'ดูใบสั่งสินค้า' }
        : { title: 'ข้าวกำลังไปส่ง', text: 'ร้านกำลังนำข้าวไปส่ง' + (o.payMethod === 'cod' ? ' เตรียมเงินสด ' + total + ' ไว้ด้วยนะคะ' : ''), bg: C.green, btn: 'ดูใบสั่งสินค้า' };
    case 'done':
      return { title: 'ได้รับข้าวเรียบร้อย', text: 'ขอบคุณที่อุดหนุน' + shopName_(s), bg: C.green, btn: 'สั่งข้าวอีกครั้ง', home: true };
    case 'cancelled':
      return { title: 'ยกเลิกการสั่งข้าวแล้ว', text: o.cancelReason || 'ยกเลิกแล้ว', bg: C.red, btn: 'ดูใบสั่งสินค้า' };
  }
  return { title: STATUS_LABEL[o.status] || o.status, text: '', bg: C.brand, btn: 'ดูใบสั่งสินค้า' };
}

/** ข้อความแจ้งสถานะให้ลูกค้า — opts: {from, note} */
function flexStatus_(o, s, opts) {
  opts = opts || {};
  const c = statusCopy_(o, s, opts.from);
  const body = [t_(c.text, { size: 'lg' })];
  if (opts.note && o.status !== 'cancelled') body.push(t_('ข้อความจากร้าน: ' + opts.note, { color: C.ink2, margin: 'md' }));
  if (o.itemsText) body.push(t_(o.itemsText, { size: 'sm', color: C.ink3, margin: 'lg' }));
  return flex_(c.title + ' #' + o.orderId + ' — ' + c.text, bubble_({
    title: c.title,
    subtitle: 'ใบสั่งสินค้า เลขที่ ' + o.orderId,
    headerBg: c.bg,
    body: body,
    buttons: [btn_(c.btn, liffUrl_(c.home ? '' : o.orderId), 'primary', C.brand)],
  }));
}

/* ---------------- Admin messages ---------------- */

function deliveryText_(o) {
  if (o.deliveryMethod === 'pickup') return 'มารับเองที่ร้าน';
  return 'ส่งถึงที่' + (o.address ? ': ' + o.address : '') + (o.distanceKm ? ' (ห่างร้าน ~' + o.distanceKm + ' กม.)' : '');
}

function flexAdminNewOrder_(o, s) {
  const body = [
    kv_('ลูกค้า', o.fullName || o.lineName, { weight: 'bold' }),
    kv_('โทร', o.phone || '-'),
    kv_('ซื้อไป', o.purposeLabel + (o.purposeNote ? ' — ' + o.purposeNote : ''), { weight: 'bold', color: C.brand }),
    { type: 'separator', margin: 'md', color: C.line },
    t_(o.itemsText, { margin: 'md', weight: 'bold' }),
    t_('รวม ' + o.totalBags + ' ถุง / ' + o.totalKg + ' กก.', { size: 'sm', color: C.ink3 }),
    { type: 'separator', margin: 'md', color: C.line },
    t_(deliveryText_(o), { margin: 'md', size: 'sm' }),
  ];
  if (o.wantDate) body.push(t_('ต้องการรับ: ' + o.wantDate, { size: 'sm' }));
  if (o.note) body.push(t_('หมายเหตุ: ' + o.note, { size: 'sm', color: C.ink2 }));
  return flex_('คำสั่งซื้อใหม่ #' + o.orderId + ' จาก ' + (o.fullName || o.lineName) + ' (' + o.purposeLabel + ')', bubble_({
    title: 'คำสั่งซื้อใหม่',
    subtitle: '#' + o.orderId,
    headerBg: C.gold, headerColor: C.ink, subColor: C.ink,
    body: body,
    buttons: [
      btn_('เปิดหน้าแอดมินเพื่อคิดราคา', adminUrl_(o.orderId)),
      btn_('โทรหาลูกค้า', telUri_(o.phone), 'secondary'),
      btn_('ดูแผนที่', mapUrl_(o.lat, o.lng), 'secondary'),
    ],
  }));
}

function flexAdminEvent_(o, s, title, text) {
  return flex_(title + ' #' + o.orderId, bubble_({
    title: title,
    subtitle: '#' + o.orderId + ' — ' + (o.fullName || o.lineName),
    headerBg: C.gold, headerColor: C.ink, subColor: C.ink,
    body: [t_(text || STATUS_LABEL[o.status])],
    buttons: [btn_('เปิดหน้าแอดมิน', adminUrl_(o.orderId))],
  }));
}

/* ---------------- Webhook ---------------- */

/**
 * หมายเหตุ: Apps Script อ่าน header X-Line-Signature ไม่ได้
 * ระบบจึงทำงานกับ webhook แบบ "ตอบกลับเท่านั้น" (reply) ซึ่งปลอดภัย
 * เพราะ replyToken ปลอมใช้ส่งข้อความไม่ได้ และไม่มีการแก้ข้อมูลจาก webhook
 */
function handleWebhook_(body) {
  (body.events || []).forEach(function (ev) {
    try {
      const uid = ev.source && ev.source.userId;
      if (ev.type === 'follow') {
        logWebhook_(ev.type, reply_(ev.replyToken, [flexWelcome_(getSettings_())]));
        return;
      }
      logWebhook_(ev.type + (ev.message ? ':' + ev.message.type : ''), null);
      if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') return;
      const text = String(ev.message.text || '').trim();
      const s = getSettings_();

      // ข้อความที่หน้าเว็บส่งแทนลูกค้า เช่น "สั่งข้าว #R261030-001" → ตอบสถานะ (ฟรี ไม่กินโควตา)
      const m = text.match(/#(R\d{6}-\d{3,})/);
      if (m && uid) {
        const o = getOrderRow_(m[1]);
        if (o && o.userId === uid) reply_(ev.replyToken, [flexStatus_(orderView_(o), s)]);
        return;
      }
      if (/^(สั่งข้าว|สั่งข้าวสาร|สั่งซื้อ|เมนู|menu)$/i.test(text)) {
        reply_(ev.replyToken, [flexWelcome_(s)]);
        return;
      }
      if (/^(สถานะ|เช็คสถานะ|ติดตาม|ติดตามสถานะ)/.test(text) && uid) {
        const list = ordersOfUser_(uid);
        reply_(ev.replyToken, [list.length
          ? flexStatus_(list[0], s)
          : { type: 'text', text: 'ยังไม่เคยสั่งข้าว พิมพ์ "สั่งข้าว" เพื่อเริ่มสั่ง' }]);
      }
      // ข้อความอื่น ๆ ปล่อยให้แอดมินตอบเองใน LINE OA Manager
    } catch (err) {
      console.error('event', err && err.stack || err);
      logWebhook_(ev && ev.type, { ok: false, error: String(err && err.message || err) });
    }
  });
}

/** เก็บ 10 เหตุการณ์ webhook ล่าสุด (ชนิด เวลา ผลการตอบกลับ — ไม่เก็บข้อมูลลูกค้า) ไว้ตรวจปัญหา */
function logWebhook_(type, result) {
  try {
    const props = PropertiesService.getScriptProperties();
    const log = parseJson_(props.getProperty('WEBHOOK_LOG'), []);
    log.unshift({ at: new Date().toISOString(), type: type, ok: result ? !!result.ok : null, error: result && result.error ? String(result.error).slice(0, 200) : '' });
    props.setProperty('WEBHOOK_LOG', JSON.stringify(log.slice(0, 10)));
  } catch (e) { /* ไม่ให้การบันทึกทำให้ตอบลูกค้าไม่ได้ */ }
}

/** ตรวจการเชื่อม LINE: token เป็นของ OA ไหน, webhook URL ที่ตั้งไว้, เหตุการณ์ล่าสุด (ไม่มีความลับ) */
function lineStatus_() {
  const token = prop_('LINE_CHANNEL_ACCESS_TOKEN');
  const out = { tokenSet: !!token, webhookLog: parseJson_(prop_('WEBHOOK_LOG'), []), myUrl: ScriptApp.getService().getUrl() };
  if (!token) return out;
  const get = function (url) {
    const r = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    return { code: r.getResponseCode(), body: parseJson_(r.getContentText(), {}) };
  };
  const info = get('https://api.line.me/v2/bot/info');
  out.bot = info.code === 200 ? { name: info.body.displayName, basicId: info.body.basicId, chatMode: info.body.chatMode } : { error: 'HTTP ' + info.code + ' ' + (info.body.message || '') };
  const wh = get('https://api.line.me/v2/bot/channel/webhook/endpoint');
  out.webhook = wh.code === 200 ? { url: wh.body.endpoint, active: wh.body.active } : { error: 'HTTP ' + wh.code + ' ' + (wh.body.message || '') };
  return out;
}
