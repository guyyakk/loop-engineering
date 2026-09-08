/**
 * WebApp.gs — เปิดฟอร์มจดประชุมเป็นลิงก์เดียว ไม่ต้องเปิดชีตและไม่ต้องหาเมนู
 *
 * ฟังก์ชันในไฟล์นี้ห้ามเรียก ui_() เด็ดขาด เพราะ SpreadsheetApp.getUi()
 * ใช้ได้เฉพาะตอนเปิดจากในชีต ถ้าเรียกจาก Web App จะพังทันที
 * ทุกอย่างที่ต้องคุยกับผู้ใช้จึงส่งเป็นข้อมูลกลับไปให้หน้าเว็บแสดงเอง
 */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('FormUi')
    .setTitle('จดประชุม MOM')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * สถานะที่หน้าเว็บต้องรู้ — โหมดส่ง และจำนวนคนที่มีอีเมลจริง
 * (ผู้ใช้ที่ใช้เฉพาะ Web App จะไม่เห็นเมนูในชีต จึงต้องเห็นข้อมูลพวกนี้ในหน้าเว็บ)
 */
function webContext() {
  var map = peopleMap_();
  var total = 0, withEmail = 0;
  Object.keys(map).forEach(function (n) {
    if (!map[n].active) return;
    total++;
    if (map[n].email) withEmail++;
  });
  return {
    dry_run: cfgBool_('DRY_RUN'),
    send_individual: cfgBool_('SEND_INDIVIDUAL'),
    people_total: total,
    people_with_email: withEmail
  };
}

/**
 * สลับโหมดทดสอบ/ส่งจริงจากหน้าเว็บ
 * เป็นการกระทำที่มีผลจริง (ปิดแล้วอีเมลจะออกทันทีที่กดปิดประชุม)
 * จึงให้หน้าเว็บถามยืนยันก่อนเรียกฟังก์ชันนี้เสมอ
 */
function webSetDryRun(next) {
  props_().setProperty('DRY_RUN', next ? 'true' : 'false');
  return webContext();
}

/**
 * ขั้นที่ 1 ของการปิดประชุม: บันทึก + ตรวจ + บอกว่าจะส่งถึงใครบ้าง
 * ยังไม่ส่งอะไรออกไป เพื่อให้คนได้เห็นรายชื่อผู้รับก่อนกดยืนยัน (human gate)
 */
function webPreview(p) {
  var saved = formSave(p, true);
  var meeting = findMeeting_(saved.meeting_id);
  var r = recipientsOf_(meeting);
  var warnings = saved.warnings.slice();
  if (!r.to.length) {
    warnings.push('ไม่มีผู้รับอีเมลเลย จะข้ามการส่งอีเมลและสร้างเฉพาะรูปกับข้อความสำหรับ LINE — ถ้าต้องการให้ส่งเมล ให้กรอกคอลัมน์ email ในชีต people');
  }
  return {
    meeting_id: saved.meeting_id,
    errors: saved.errors,
    warnings: warnings,
    dry_run: cfgBool_('DRY_RUN'),
    already_sent: String(meeting.status || '').toLowerCase() === STATUS.SENT,
    sent_at: fmtDateTime_(meeting.sent_at),
    to: r.to,
    cc: r.cc,
    send_individual: cfgBool_('SEND_INDIVIDUAL'),
    item_count: getItems_(saved.meeting_id).length
  };
}

/**
 * ขั้นที่ 2: ส่งจริง (ตามโหมด DRY_RUN) แล้วสร้างรูปกับข้อความสำหรับ LINE
 * ถ้าประชุมนี้ส่งอีเมลไปแล้ว จะข้ามการส่งแต่ยังสร้างรูปใหม่ให้
 */
function webFinish(p) {
  var saved = formSave(p, true);
  if (saved.errors.length) return { ok: false, errors: saved.errors };

  var id = saved.meeting_id;
  var meeting = findMeeting_(id);
  var items = getItems_(id);
  var out = { ok: true, meeting_id: id, errors: [], warnings: saved.warnings };

  if (String(meeting.status || '').toLowerCase() === STATUS.SENT) {
    out.already_sent = true;
    out.sent_at = fmtDateTime_(meeting.sent_at);
  } else {
    // อีเมลกับรูปเป็นอิสระต่อกัน ถ้าเมลมีปัญหาก็ยังต้องได้รูปกับข้อความสำหรับ LINE
    try {
      var res = sendSummaryEmails_(meeting, items);
      out.dry_run = res.dryRun;
      out.recipients = res.to.length;
      out.personal = res.personalCount;
      out.quota_left = res.quotaLeft;
      out.email_skipped = res.skipped || '';
      if (!res.dryRun && !res.skipped) {
        setCell_(SHEET.MEETINGS, meeting._row, 'status', STATUS.SENT);
        setCell_(SHEET.MEETINGS, meeting._row, 'sent_at', new Date());
      }
    } catch (e) {
      out.email_error = String(e.message || e);
    }
  }

  try {
    var img = buildMeetingImage_(meeting, items);
    setCell_(SHEET.MEETINGS, meeting._row, 'image_url', img.url);
    out.image_url = img.url;
    out.image_name = img.name;
  } catch (e) {
    // รูปพังไม่ควรทำให้ทั้งขั้นตอนล้ม เพราะอีเมลส่งไปแล้ว
    out.image_error = String(e.message || e);
  }

  out.line_text = buildLineText_(meeting, items);
  return out;
}

function findMeeting_(id) {
  var m = readTable_(SHEET.MEETINGS).filter(function (x) {
    return String(x.meeting_id).trim() === String(id).trim();
  })[0];
  if (!m) throw new Error('ไม่พบการประชุมรหัส ' + id + ' ในชีต');
  return m;
}
