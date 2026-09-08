/**
 * Menu.gs — เมนูในชีตและลำดับการทำงานหลัก
 *
 * หลักการ: ทุกอย่างที่ส่งออกภายนอกต้องผ่าน dialog ยืนยันจากคนก่อนเสมอ (human gate)
 * และค่าเริ่มต้นของระบบคือ DRY_RUN = true
 */

function onOpen() {
  ui_().createMenu('MOM')
    .addItem('📝 จดประชุม (เปิดฟอร์ม)', 'openNoteForm')
    .addSeparator()
    .addItem('📧 ส่งอีเมลสรุป', 'sendSummaryUI')
    .addItem('🖼 สร้างรูปสำหรับ LINE', 'buildImageUI')
    .addItem('📋 คัดลอกข้อความสรุป (วางใน LINE)', 'copyTextUI')
    .addSeparator()
    .addItem('🔍 ตรวจข้อมูลก่อนส่ง', 'validateActiveMeetingUI')
    .addItem('➕ เพิ่มการประชุมใหม่ (กรอกในชีตเอง)', 'addMeeting')
    .addItem('⚙ ดูค่าตั้งค่าปัจจุบัน', 'showSettings')
    .addItem('⚙ สลับโหมดทดสอบ / ส่งจริง', 'toggleDryRun')
    .addItem('⚙ ตั้งค่าเริ่มต้น (สร้าง/ซ่อมชีต)', 'setupSheets')
    .addToUi();
}

/** โหลดข้อมูลประชุมที่กำลังทำงานด้วย พร้อมรายการงานของประชุมนั้น */
function loadActive_() {
  var meeting = getActiveMeeting_();
  var items = getItems_(meeting.meeting_id);
  return { meeting: meeting, items: items };
}

function issuesText_(v) {
  var out = [];
  if (v.errors.length) {
    out.push('❌ ต้องแก้ก่อนส่ง (' + v.errors.length + ' ข้อ)');
    v.errors.forEach(function (e) { out.push('   • ' + e); });
  }
  if (v.warnings.length) {
    if (out.length) out.push('');
    out.push('⚠ ข้อควรระวัง (' + v.warnings.length + ' ข้อ) — ส่งได้แต่ควรอ่านก่อน');
    v.warnings.forEach(function (w) { out.push('   • ' + w); });
  }
  if (!out.length) out.push('✅ ข้อมูลครบถ้วน ไม่พบปัญหา');
  return out.join('\n');
}

function validateActiveMeetingUI() {
  var d = loadActive_();
  var v = validateMeeting_(d.meeting, d.items);
  ui_().alert(
    'ผลตรวจ: ' + d.meeting.meeting_id + ' — ' + d.meeting.title,
    'จำนวน action items: ' + d.items.length + '\n\n' + issuesText_(v),
    ui_().ButtonSet.OK
  );
}

function sendSummaryUI() {
  var d = loadActive_();
  var meeting = d.meeting, items = d.items;

  // กันส่งซ้ำ: ประชุมที่ส่งไปแล้วต้องล้าง sent_at เองก่อนถึงจะส่งใหม่ได้
  if (String(meeting.status || '').toLowerCase() === STATUS.SENT) {
    ui_().alert(
      'ส่งไปแล้ว',
      'การประชุม ' + meeting.meeting_id + ' ส่งอีเมลไปแล้วเมื่อ ' + fmtDateTime_(meeting.sent_at) +
      '\n\nถ้าต้องการส่งซ้ำจริง ๆ ให้ล้างค่าในคอลัมน์ status และ sent_at ของแถวนั้นก่อน',
      ui_().ButtonSet.OK
    );
    return;
  }

  var v = validateMeeting_(meeting, items);
  if (v.errors.length) {
    ui_().alert('ยังส่งไม่ได้', issuesText_(v), ui_().ButtonSet.OK);
    return;
  }

  var r = recipientsOf_(meeting);
  var dry = cfgBool_('DRY_RUN');
  var confirmMsg = [
    (dry ? '🧪 โหมดทดสอบ (DRY_RUN) — จะไม่มีอีเมลออกจริง' : '📧 โหมดส่งจริง — อีเมลจะถูกส่งออกทันที'),
    '',
    'ประชุม: ' + meeting.title + ' (' + meeting.meeting_id + ')',
    'วันที่: ' + fmtDate_(meeting.date),
    'Action items: ' + items.length + ' รายการ',
    'ผู้รับ (To): ' + r.to.length + ' คน',
    r.to.join(', ') || '(ไม่มี)',
    'สำเนา (CC): ' + (r.cc.join(', ') || '(ไม่มี)'),
    'เมลรายบุคคล: ' + (cfgBool_('SEND_INDIVIDUAL') ? 'ส่งด้วย' : 'ไม่ส่ง')
  ];
  if (v.warnings.length) {
    confirmMsg.push('');
    confirmMsg.push(issuesText_({ errors: [], warnings: v.warnings }));
  }
  confirmMsg.push('');
  confirmMsg.push('ยืนยันหรือไม่');

  if (ui_().alert('ยืนยันก่อนส่ง', confirmMsg.join('\n'), ui_().ButtonSet.YES_NO) !== ui_().Button.YES) {
    return;
  }

  var res = sendSummaryEmails_(meeting, items);

  if (!res.dryRun) {
    setCell_(SHEET.MEETINGS, meeting._row, 'status', STATUS.SENT);
    setCell_(SHEET.MEETINGS, meeting._row, 'sent_at', new Date());
  }

  ui_().alert(
    res.dryRun ? 'ทดสอบเสร็จ (ยังไม่ส่งจริง)' : 'ส่งอีเมลแล้ว',
    [
      'หัวข้อ: ' + res.subject,
      'ผู้รับ: ' + res.to.length + ' คน' + (res.cc.length ? ' + CC ' + res.cc.length : ''),
      'เมลรายบุคคล: ' + res.personalCount + ' ฉบับ',
      'โควตาเมลคงเหลือวันนี้: ' + res.quotaLeft,
      '',
      res.dryRun
        ? 'เปิด Executions ใน Apps Script เพื่อดู log ของเนื้อหาที่จะส่ง\nเมื่อพร้อมส่งจริง ให้สั่งเมนู "สลับโหมดทดสอบ / ส่งจริง"'
        : 'บันทึกสถานะเป็น sent แล้ว กดส่งซ้ำจะถูกปฏิเสธ'
    ].join('\n'),
    ui_().ButtonSet.OK
  );
}

function buildImageUI() {
  var d = loadActive_();
  var v = validateMeeting_(d.meeting, d.items);
  if (v.errors.length) {
    ui_().alert('ข้อมูลยังไม่ครบ', 'สร้างรูปได้ แต่ควรแก้ก่อน\n\n' + issuesText_(v), ui_().ButtonSet.OK);
  }

  var res = buildMeetingImage_(d.meeting, d.items);
  setCell_(SHEET.MEETINGS, d.meeting._row, 'image_url', res.url);

  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">' +
    '<p>สร้างรูปเรียบร้อย: <b>' + esc_(res.name) + '</b><br>' +
    'เก็บไว้ในโฟลเดอร์ Drive ชื่อ "' + esc_(res.folder) + '"</p>' +
    '<p><a href="' + esc_(res.url) + '" target="_blank" rel="noopener" ' +
    'style="display:inline-block;background:#1971c2;color:#fff;padding:10px 16px;' +
    'border-radius:6px;text-decoration:none">เปิดรูปเพื่อเซฟ</a></p>' +
    '<p style="color:#666;font-size:12px">เปิดรูป → กดดาวน์โหลด → วางในกลุ่ม LINE<br>' +
    'ลิงก์รูปถูกบันทึกไว้ในคอลัมน์ image_url ของแถวประชุมนี้ด้วยแล้ว</p></div>'
  ).setWidth(420).setHeight(240);
  ui_().showModalDialog(html, 'รูปสรุปสำหรับ LINE');
}

function copyTextUI() {
  var d = loadActive_();
  var text = buildLineText_(d.meeting, d.items);
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;font-size:13px">' +
    '<p style="margin:0 0 8px">กดปุ่มคัดลอก แล้วนำไปวางในกลุ่ม LINE ได้เลย</p>' +
    '<textarea id="t" style="width:100%;height:280px;font-family:monospace;font-size:12px;' +
    'padding:8px;border:1px solid #ccc;border-radius:4px">' + esc_(text) + '</textarea>' +
    '<p><button onclick="cp()" style="background:#1971c2;color:#fff;border:0;padding:10px 16px;' +
    'border-radius:6px;cursor:pointer;font-size:14px">คัดลอกข้อความ</button> ' +
    '<span id="ok" style="color:#2f9e44"></span></p>' +
    '<script>function cp(){var t=document.getElementById("t");t.select();' +
    'document.execCommand("copy");document.getElementById("ok").textContent="คัดลอกแล้ว";}<\/script>' +
    '</div>'
  ).setWidth(520).setHeight(430);
  ui_().showModalDialog(html, 'ข้อความสรุปสำหรับ LINE');
}
