/**
 * Setup.gs — สร้างชีตทั้งหมดพร้อม dropdown และกฎตรวจข้อมูล
 *
 * สั่งครั้งเดียวตอนติดตั้ง และสั่งซ้ำได้ทุกเมื่อเพื่อซ่อม dropdown ที่หายไป
 * ฟังก์ชันนี้ไม่ลบข้อมูลเดิม ถ้าหัวตารางไม่ตรงกับที่ระบบต้องการจะเตือนแทนการเขียนทับ
 */

var HEADERS = {};
HEADERS[SHEET.MEETINGS] = ['meeting_id', 'title', 'date', 'start_time', 'end_time', 'location',
  'chair', 'note_taker', 'attendees', 'absentees', 'decisions', 'open_issues',
  'next_meeting_at', 'status', 'sent_at', 'image_url'];
HEADERS[SHEET.ITEMS] = ['item_id', 'meeting_id', 'task', 'owner', 'due_date', 'priority', 'status', 'note'];
HEADERS[SHEET.PEOPLE] = ['name', 'email', 'department', 'active'];

var LAST_ROW = 1000; // ช่วงแถวที่ใส่ dropdown และกฎตรวจไว้ล่วงหน้า

function setupSheets() {
  var ss = ss_();
  var created = [];
  var mismatched = [];

  Object.keys(HEADERS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      created.push(name);
    }
    var expected = HEADERS[name];
    var width = Math.max(sh.getLastColumn(), expected.length);
    var current = sh.getRange(1, 1, 1, width).getValues()[0]
      .map(function (h) { return String(h).trim(); })
      .filter(function (h) { return h !== ''; });

    if (!current.length) {
      sh.getRange(1, 1, 1, expected.length).setValues([expected]);
    } else if (expected.join('|') !== current.slice(0, expected.length).join('|')) {
      mismatched.push(name + ': ต้องการ [' + expected.join(', ') + '] แต่พบ [' + current.join(', ') + ']');
      return; // ไม่เขียนทับหัวตารางที่มีข้อมูลอยู่แล้ว
    }
    formatHeader_(sh, expected.length);
  });

  props_().setProperty('SPREADSHEET_ID', ss.getId()); // ให้ Web App หาชีตนี้เจอ

  if (created.indexOf(SHEET.PEOPLE) !== -1) seedPeople_();

  var setupError = '';
  try {
    applyValidations_();
    applyFormats_();
    applyConditionalFormats_();
    addHeaderNotes_();
  } catch (e) {
    // เกิดได้เมื่อหัวตารางไม่ตรง ทำให้หาคอลัมน์ไม่เจอ — บอกให้ชัดแทนที่จะล้มเงียบ
    setupError = String(e.message || e);
  }

  var msg = ['ตั้งค่าชีตเรียบร้อย'];
  msg.push('สร้างใหม่: ' + (created.length ? created.join(', ') : 'ไม่มี (มีอยู่แล้วทั้งหมด)'));
  if (mismatched.length) {
    msg.push('');
    msg.push('⚠ หัวตารางไม่ตรงกับที่ระบบต้องการ ระบบไม่ได้แก้ให้เพื่อกันข้อมูลเสียหาย:');
    mismatched.forEach(function (m) { msg.push('   • ' + m); });
  }
  if (setupError) {
    msg.push('');
    msg.push('⚠ ตั้ง dropdown/รูปแบบไม่สำเร็จ: ' + setupError);
    msg.push('แก้หัวตารางให้ตรงตามรายการข้างบนก่อน แล้วสั่งเมนูนี้อีกครั้ง');
  }
  msg.push('');
  msg.push('ขั้นถัดไป: กรอกชื่อและอีเมลทีมในชีต people แล้วสั่ง MOM → เพิ่มการประชุมใหม่');
  ui_().alert('ตั้งค่าเริ่มต้น', msg.join('\n'), ui_().ButtonSet.OK);
}

/**
 * ใส่คำอธิบายไว้ที่หัวตาราง (เอาเมาส์ชี้แล้วเห็น) สำหรับคนที่เผลอมากรอกในชีตตรง ๆ
 * ปกติควรกรอกผ่านเมนู MOM → 📝 จดประชุม แทน
 */
var HEADER_NOTES = {};
HEADER_NOTES[SHEET.MEETINGS] = {
  meeting_id: 'รหัสประชุม ระบบสร้างให้เอง ห้ามแก้',
  title: 'จำเป็น — ชื่อการประชุม',
  date: 'จำเป็น — วันที่ประชุม รูปแบบ YYYY-MM-DD',
  start_time: 'เวลาเริ่ม เช่น 10:00',
  end_time: 'เวลาจบ เช่น 11:00',
  location: 'ห้องประชุม หรือลิงก์ออนไลน์',
  chair: 'ประธานที่ประชุม',
  note_taker: 'จำเป็น — คนจดบันทึก',
  attendees: 'จำเป็น — ชื่อผู้เข้าร่วม คั่นด้วย , ชื่อต้องตรงกับชีต people ถึงจะได้รับอีเมล',
  absentees: 'คนที่ไม่ได้เข้าประชุมแต่ต้องได้รับสรุป',
  decisions: 'มติที่ประชุม บรรทัดละ 1 ข้อ (ขึ้นบรรทัดใหม่ด้วย Alt+Enter)',
  open_issues: 'ประเด็นค้างที่ยังไม่มีเจ้าภาพ บรรทัดละ 1 ข้อ',
  next_meeting_at: 'วันเวลาประชุมครั้งถัดไป',
  status: 'draft = ยังไม่ส่ง / sent = ส่งอีเมลแล้ว ระบบเขียนให้เอง',
  sent_at: 'เวลาที่ส่งอีเมลสำเร็จ ระบบเขียนให้เอง ล้างช่องนี้ถ้าต้องการส่งซ้ำ',
  image_url: 'ลิงก์รูปสรุปล่าสุด ระบบเขียนให้เอง'
};
HEADER_NOTES[SHEET.ITEMS] = {
  item_id: 'รหัสงาน ระบบสร้างให้เอง ห้ามแก้',
  meeting_id: 'จำเป็น — เลือกจาก dropdown ว่างานนี้มาจากประชุมไหน',
  task: 'จำเป็น — เขียนว่าต้องทำอะไร จะสั้นหรือยาวก็ได้',
  owner: 'จำเป็น — เลือกจาก dropdown และต้องเป็นคนเดียว ถ้าหลายคนให้แตกเป็นหลายแถว',
  due_date: 'จำเป็น — กำหนดเสร็จ ต้องไม่ย้อนหลังกว่าวันประชุม',
  priority: 'High / Medium / Low',
  status: 'Open → In progress → Done (หรือ Blocked ถ้าติดปัญหา) ช่องนี้อัปเดตเองระหว่างสัปดาห์',
  note: 'สิ่งที่ต้องรอ หรือปัญหาที่ติดอยู่'
};
HEADER_NOTES[SHEET.PEOPLE] = {
  name: 'ชื่อที่จะโผล่ใน dropdown ของฟอร์มและชีตงาน',
  email: 'อีเมลสำหรับรับสรุปการประชุม ถ้าเว้นว่างคนนี้จะไม่ได้รับเมล',
  department: 'แผนก (ไม่บังคับ)',
  active: 'yes = ยังอยู่ในทีม / no = ซ่อนจาก dropdown โดยไม่ต้องลบประวัติ'
};

function addHeaderNotes_() {
  Object.keys(HEADER_NOTES).forEach(function (name) {
    var sh = sheet_(name);
    var notes = HEADER_NOTES[name];
    Object.keys(notes).forEach(function (h) {
      sh.getRange(1, colIndex_(name, h)).setNote(notes[h]);
    });
  });
}

function formatHeader_(sh, cols) {
  var head = sh.getRange(1, 1, 1, cols);
  head.setFontWeight('bold').setBackground('#e7f5ff').setVerticalAlignment('middle');
  sh.setFrozenRows(1);
}

function seedPeople_() {
  var sh = sheet_(SHEET.PEOPLE);
  sh.getRange(2, 1, 2, 4).setValues([
    ['ตัวอย่าง สมชาย', 'somchai@example.com', 'Production', 'yes'],
    ['ตัวอย่าง สุดา', 'suda@example.com', 'QC', 'yes']
  ]);
  sh.getRange(4, 1).setValue('← ลบสองแถวตัวอย่างข้างบนออก แล้วกรอกชื่อจริงของทีม');
  sh.getRange(4, 1).setFontColor('#868e96').setFontStyle('italic');
}

function applyValidations_() {
  var items = sheet_(SHEET.ITEMS);
  var meetings = sheet_(SHEET.MEETINGS);
  var people = sheet_(SHEET.PEOPLE);
  var rows = LAST_ROW - 1;

  // owner ต้องเลือกจากทะเบียนรายชื่อเท่านั้น กันชื่อสะกดไม่ตรงกันแต่ละครั้ง
  setRule_(items, 'owner', SpreadsheetApp.newDataValidation()
    .requireValueInRange(people.getRange('A2:A' + LAST_ROW), true)
    .setAllowInvalid(false)
    .setHelpText('เลือกชื่อจากชีต people — ถ้ายังไม่มีให้ไปเพิ่มก่อน และใส่ได้ทีละ 1 คน')
    .build(), rows);

  setRule_(items, 'meeting_id', SpreadsheetApp.newDataValidation()
    .requireValueInRange(meetings.getRange('A2:A' + LAST_ROW), true)
    .setAllowInvalid(false)
    .build(), rows);

  setRule_(items, 'priority', listRule_(PRIORITY), rows);
  setRule_(items, 'status', listRule_(ITEM_STATUS), rows);
  setRule_(items, 'due_date', SpreadsheetApp.newDataValidation()
    .requireDate().setAllowInvalid(false)
    .setHelpText('ต้องเป็นวันที่จริง รูปแบบ YYYY-MM-DD')
    .build(), rows);

  setRule_(meetings, 'date', SpreadsheetApp.newDataValidation()
    .requireDate().setAllowInvalid(false).build(), rows);
  setRule_(meetings, 'status', listRule_([STATUS.DRAFT, STATUS.SENT]), rows);
  setRule_(people, 'active', listRule_(['yes', 'no']), rows);
}

function listRule_(values) {
  return SpreadsheetApp.newDataValidation()
    .requireValueInList(values, true)
    .setAllowInvalid(false)
    .build();
}

function setRule_(sheet, header, rule, rows) {
  var col = colIndex_(sheet.getName(), header);
  sheet.getRange(2, col, rows, 1).setDataValidation(rule);
}

function applyFormats_() {
  var meetings = sheet_(SHEET.MEETINGS);
  var items = sheet_(SHEET.ITEMS);
  var rows = LAST_ROW - 1;

  fmtCol_(meetings, 'date', 'yyyy-mm-dd', rows);
  fmtCol_(meetings, 'start_time', 'HH:mm', rows);
  fmtCol_(meetings, 'end_time', 'HH:mm', rows);
  fmtCol_(meetings, 'next_meeting_at', 'yyyy-mm-dd HH:mm', rows);
  fmtCol_(meetings, 'sent_at', 'yyyy-mm-dd HH:mm', rows);
  fmtCol_(items, 'due_date', 'yyyy-mm-dd', rows);

  meetings.setColumnWidth(colIndex_(SHEET.MEETINGS, 'title'), 220);
  meetings.setColumnWidth(colIndex_(SHEET.MEETINGS, 'attendees'), 260);
  meetings.setColumnWidth(colIndex_(SHEET.MEETINGS, 'decisions'), 300);
  meetings.setColumnWidth(colIndex_(SHEET.MEETINGS, 'open_issues'), 260);
  items.setColumnWidth(colIndex_(SHEET.ITEMS, 'task'), 380);
  items.setColumnWidth(colIndex_(SHEET.ITEMS, 'note'), 220);

  // ช่องที่พิมพ์ยาวหลายบรรทัด ให้ตัดคำอัตโนมัติ จะได้เห็นทั้งหมดระหว่างประชุม
  [['decisions'], ['open_issues'], ['attendees']].forEach(function (h) {
    meetings.getRange(2, colIndex_(SHEET.MEETINGS, h[0]), rows, 1).setWrap(true);
  });
  items.getRange(2, colIndex_(SHEET.ITEMS, 'task'), rows, 1).setWrap(true);
}

function fmtCol_(sheet, header, format, rows) {
  sheet.getRange(2, colIndex_(sheet.getName(), header), rows, 1).setNumberFormat(format);
}

/** ระบายสีให้เห็นงานเลยกำหนดและงานที่เสร็จแล้ว โดยไม่ต้องเปิดอีเมล */
function applyConditionalFormats_() {
  var sh = sheet_(SHEET.ITEMS);
  var range = sh.getRange(2, 1, LAST_ROW - 1, HEADERS[SHEET.ITEMS].length);
  var dueCol = columnLetter_(colIndex_(SHEET.ITEMS, 'due_date'));
  var statusCol = columnLetter_(colIndex_(SHEET.ITEMS, 'status'));

  var overdue = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($' + dueCol + '2<>"",$' + dueCol + '2<TODAY(),$' + statusCol + '2<>"Done")')
    .setBackground('#ffe3e3')
    .setRanges([range])
    .build();

  var done = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$' + statusCol + '2="Done"')
    .setBackground('#ebfbee')
    .setFontColor('#868e96')
    .setRanges([range])
    .build();

  sh.setConditionalFormatRules([done, overdue]);
}

function columnLetter_(index) {
  var s = '';
  while (index > 0) {
    var m = (index - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    index = Math.floor((index - m) / 26);
  }
  return s;
}

/** สร้างแถวประชุมใหม่พร้อมรหัสถัดไป แล้วพาเคอร์เซอร์ไปที่แถวนั้น */
function addMeeting() {
  var sh = sheet_(SHEET.MEETINGS);
  var id = nextMeetingId_();
  var row = sh.getLastRow() + 1;

  sh.getRange(row, colIndex_(SHEET.MEETINGS, 'meeting_id')).setValue(id);
  sh.getRange(row, colIndex_(SHEET.MEETINGS, 'date')).setValue(new Date());
  sh.getRange(row, colIndex_(SHEET.MEETINGS, 'status')).setValue(STATUS.DRAFT);

  sh.activate();
  sh.setActiveRange(sh.getRange(row, colIndex_(SHEET.MEETINGS, 'title')));
  ui_().alert('สร้างการประชุมใหม่',
    'รหัส: ' + id + '\n\nกรอกชื่อการประชุมและรายละเอียดในแถวที่ ' + row +
    ' แล้วบันทึก action items ในชีต action_items โดยเลือก meeting_id = ' + id,
    ui_().ButtonSet.OK);
}
