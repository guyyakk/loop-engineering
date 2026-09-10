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
    build: (typeof BUILD_STAMP === 'string' ? BUILD_STAMP : ''),
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
 *
 * แบ่งเป็นสองช่วงโดยตั้งใจ:
 *  - ช่วงที่ถือล็อก = บันทึก + ตรวจ + อ่านสถานะ + ส่งอีเมล + ปั๊มสถานะเป็น sent
 *    ทั้งหมดนี้ต้องเป็นก้อนเดียวกัน ไม่งั้นเปิดสองแท็บแล้วกดพร้อมกันจะเห็นสถานะเป็น draft
 *    ทั้งคู่แล้วส่งอีเมลซ้ำ กลไกกันส่งซ้ำจะใช้ไม่ได้เลย
 *  - ช่วงที่ไม่ถือล็อก = สร้างรูป ซึ่งใช้เวลา 10–20 วินาทีและไม่แตะสถานะร่วม
 *    ถ้าถือล็อกไว้ตลอด คนอื่นจะกดบันทึกไม่ได้ทั้งที่ไม่จำเป็น
 */
function webFinish(p) {
  var prepared = withDocumentLock_(function () {
    var saved = formSaveCore_(p, true);
    if (saved.errors.length) return { ok: false, errors: saved.errors };

    var id = saved.meeting_id;
    var meeting = findMeeting_(id);
    var out = { ok: true, meeting_id: id, errors: [], warnings: saved.warnings };

    if (String(meeting.status || '').toLowerCase() === STATUS.SENT) {
      out.already_sent = true;
      out.sent_at = fmtDateTime_(meeting.sent_at);
    } else {
      // อีเมลกับรูปเป็นอิสระต่อกัน ถ้าเมลมีปัญหาก็ยังต้องได้รูปกับข้อความสำหรับ LINE
      try {
        var res = sendSummaryEmails_(meeting, getItems_(id));
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
    return out;
  });

  if (!prepared.ok) return prepared;

  var meeting = findMeeting_(prepared.meeting_id);
  var items = getItems_(prepared.meeting_id);

  try {
    var img = buildMeetingImage_(meeting, items);
    withDocumentLock_(function () {
      setCell_(SHEET.MEETINGS, meeting._row, 'image_url', img.url);
    });
    prepared.image_url = img.url;
    prepared.image_name = img.name;
    prepared.image_data = 'data:image/png;base64,' + img.base64;
  } catch (e) {
    // รูปพังไม่ควรทำให้ทั้งขั้นตอนล้ม เพราะอีเมลส่งไปแล้ว
    prepared.image_error = String(e.message || e);
  }

  prepared.line_text = buildLineText_(meeting, items);
  return prepared;
}

/**
 * เริ่มประชุมใหม่: สร้างแถวเปล่าในชีตแล้วคืนข้อมูลฟอร์มของประชุมนั้น
 *
 * ต้องสร้างแถวจริงทันที ไม่ใช่แค่ล้างฟอร์มฝั่งหน้าเว็บ เพราะถ้าฟอร์มส่ง meeting_id ว่าง
 * ระบบจะถือว่าให้เขียนทับร่างล่าสุด ซึ่งจะไปทับประชุมที่เพิ่งปิดไป
 */
function webStartNew() {
  return withDocumentLock_(function () {
    var sh = sheet_(SHEET.MEETINGS);
    var headers = HEADERS[SHEET.MEETINGS];
    var vals = { meeting_id: nextMeetingId_(), date: new Date(), status: STATUS.DRAFT };
    sh.getRange(sh.getLastRow() + 1, 1, 1, headers.length).setValues([headers.map(function (h) {
      return vals[h] === undefined ? '' : vals[h];
    })]);
    return formInit(); // ร่างล่าสุดคือแถวที่เพิ่งสร้าง
  });
}

/**
 * เพิ่มคนใหม่เข้าทะเบียนรายชื่อจากหน้าฟอร์ม (ระหว่างประชุมมีคนมาเพิ่ม)
 *
 * ตั้งใจให้บันทึกลงชีต people จริง ไม่ใช่ใส่ชื่อเฉพาะประชุมนี้ เพราะถ้าไม่บันทึก
 * คนนั้นจะรับงานไม่ได้ (ไม่โผล่ใน dropdown ผู้รับผิดชอบ) และไม่ได้รับอีเมลสรุป
 * อีเมลกับแผนกไม่บังคับ เพราะระหว่างประชุมมักยังไม่รู้ ค่อยเติมทีหลังในชีตได้
 *
 * ถ้าชื่อซ้ำกับที่มีอยู่แล้วจะไม่สร้างแถวใหม่ แต่ถือว่าเลือกคนเดิม
 * และถ้าคนนั้นถูกปิดใช้งานไว้ (active = no) จะเปิดกลับให้
 */
function webAddPerson(p) {
  var name = String((p && p.name) || '').trim();
  if (!name) throw new Error('ยังไม่ได้พิมพ์ชื่อ');
  if (looksLikeMultipleOwners_(name)) {
    throw new Error('ใส่ได้ทีละคน — ถ้ามีหลายคนให้เพิ่มทีละชื่อ');
  }

  var email = String((p && p.email) || '').trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('รูปแบบอีเมลไม่ถูกต้อง: ' + email);
  }
  var dept = String((p && p.department) || '').trim();

  return withDocumentLock_(function () {
    var sh = sheet_(SHEET.PEOPLE);
    var headers = HEADERS[SHEET.PEOPLE];
    var found = readTable_(SHEET.PEOPLE).filter(function (r) {
      return String(r.name || '').trim().toLowerCase() === name.toLowerCase();
    })[0];

    var status = 'added';
    if (found) {
      status = 'exists';
      name = String(found.name).trim(); // ใช้ตัวสะกดเดิมในทะเบียน กันชื่อเพี้ยนกันคนละแถว
      if (String(found.active || '').trim().toLowerCase() === 'no') {
        setCell_(SHEET.PEOPLE, found._row, 'active', 'yes');
        status = 'reactivated';
      }
      // เติมเฉพาะช่องที่ยังว่าง จะได้ไม่ไปทับข้อมูลที่คนอื่นกรอกไว้แล้ว
      if (email && !String(found.email || '').trim()) setCell_(SHEET.PEOPLE, found._row, 'email', email);
      if (dept && !String(found.department || '').trim()) setCell_(SHEET.PEOPLE, found._row, 'department', dept);
    } else {
      var vals = { name: name, email: email, department: dept, active: 'yes' };
      sh.getRange(sh.getLastRow() + 1, 1, 1, headers.length).setValues([headers.map(function (h) {
        return vals[h] === undefined ? '' : vals[h];
      })]);
    }

    return { status: status, name: name, has_email: !!email, people: peopleList_() };
  });
}

function findMeeting_(id) {
  var m = readTable_(SHEET.MEETINGS).filter(function (x) {
    return String(x.meeting_id).trim() === String(id).trim();
  })[0];
  if (!m) throw new Error('ไม่พบการประชุมรหัส ' + id + ' ในชีต');
  return m;
}
