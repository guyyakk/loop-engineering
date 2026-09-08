/**
 * Data.gs — อ่านข้อมูลจากชีตและตรวจความถูกต้องก่อนส่ง
 *
 * กฎที่บังคับตั้งแต่แถวแรก (ดู docs/MOM_SYSTEM_DESIGN.md ข้อ 3):
 *  - owner ต้องมีและต้องเป็นคนเดียว
 *  - due_date ต้องมีและต้องไม่ย้อนหลังกว่าวันประชุม
 *  - task ต้องยาวกว่า 10 ตัวอักษร
 */

function ss_() {
  // เปิดจากในชีตจะได้ตัวสเปรดชีตตรง ๆ แต่ถ้าเรียกจาก Web App บางกรณีจะได้ null
  // จึงมี SPREADSHEET_ID ที่บันทึกไว้ตอนตั้งค่าเริ่มต้นเป็นตัวสำรอง
  var s = SpreadsheetApp.getActiveSpreadsheet();
  if (s) return s;
  var id = cfg_('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  throw new Error('หาสเปรดชีตไม่เจอ — เปิดชีตแล้วสั่ง MOM → ตั้งค่าเริ่มต้น หนึ่งครั้งเพื่อบันทึก SPREADSHEET_ID');
}

function ui_() {
  return SpreadsheetApp.getUi();
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) {
    throw new Error('ไม่พบชีตชื่อ "' + name + '" — สั่งเมนู MOM → ตั้งค่าเริ่มต้น (สร้าง/ซ่อมชีต) ก่อน');
  }
  return sh;
}

/**
 * อ่านทั้งชีตเป็น array ของ object โดยใช้แถวแรกเป็นชื่อคีย์
 * แต่ละ object มี _row = เลขแถวจริงในชีต ไว้ใช้เขียนกลับและอ้างอิงใน error
 */
function readTable_(name) {
  var sh = sheet_(name);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (row.every(function (c) { return c === '' || c === null; })) continue; // ข้ามแถวว่าง
    var obj = { _row: r + 1 };
    for (var c = 0; c < headers.length; c++) {
      if (headers[c]) obj[headers[c]] = row[c];
    }
    out.push(obj);
  }
  return out;
}

/** หาเลขคอลัมน์จากชื่อหัวตาราง (1-based) */
function colIndex_(name, header) {
  var sh = sheet_(name);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim() === header) return i + 1;
  }
  throw new Error('ไม่พบคอลัมน์ "' + header + '" ในชีต "' + name + '"');
}

function setCell_(name, row, header, value) {
  sheet_(name).getRange(row, colIndex_(name, header)).setValue(value);
}

/** ทะเบียนรายชื่อ: ชื่อ -> {email, department} เฉพาะคนที่ active */
function peopleMap_() {
  var map = {};
  readTable_(SHEET.PEOPLE).forEach(function (p) {
    var name = String(p.name || '').trim();
    if (!name) return;
    var active = String(p.active === '' ? 'yes' : p.active).toLowerCase();
    map[name] = {
      name: name,
      email: String(p.email || '').trim(),
      department: String(p.department || '').trim(),
      active: active !== 'no' && active !== 'false'
    };
  });
  return map;
}

/**
 * เลือกการประชุมที่จะทำงานด้วย
 * 1) ถ้าเคอร์เซอร์อยู่ในชีต meetings ให้ใช้แถวนั้น
 * 2) ถ้าไม่ใช่ ให้ใช้แถวล่างสุดที่ยังเป็น draft
 * 3) ถ้าไม่มี draft เลย ให้ใช้แถวล่างสุด
 */
function getActiveMeeting_() {
  var rows = readTable_(SHEET.MEETINGS);
  if (!rows.length) throw new Error('ยังไม่มีข้อมูลในชีต "meetings" — สั่งเมนู MOM → เพิ่มการประชุมใหม่ ก่อน');

  var active = ss_().getActiveSheet();
  if (active.getName() === SHEET.MEETINGS) {
    var r = active.getActiveRange() ? active.getActiveRange().getRow() : 0;
    var hit = rows.filter(function (m) { return m._row === r; })[0];
    if (hit) return hit;
  }
  var drafts = rows.filter(function (m) { return String(m.status || '').toLowerCase() !== STATUS.SENT; });
  return drafts.length ? drafts[drafts.length - 1] : rows[rows.length - 1];
}

function getItems_(meetingId) {
  return readTable_(SHEET.ITEMS).filter(function (it) {
    return String(it.meeting_id || '').trim() === String(meetingId).trim();
  });
}

/** เช็คว่าเป็น Date จริงไหม — ใช้ toString แทน instanceof เพราะ instanceof พลาดข้าม context ได้ */
function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}

function toDate_(v) {
  if (isDate_(v)) return v;
  if (v === '' || v === null || v === undefined) return null;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function dayOnly_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function splitNames_(s) {
  return String(s || '')
    .split(/[,\n]/)
    .map(function (x) { return x.trim(); })
    .filter(function (x) { return x.length > 0; });
}

/**
 * เจ้าภาพต้องเป็นคนเดียว — ดักคำที่บอกว่าใส่มาหลายคน
 * หมายเหตุ: ห้ามใช้ \b กับคำไทย เพราะ \b อิงขอบเขตของ [A-Za-z0-9_] ทำให้ไม่แมตช์ "และ"/"กับ" เลย
 */
function looksLikeMultipleOwners_(owner) {
  return /[,/&+]|และ|กับ/.test(String(owner));
}

/**
 * ตรวจข้อมูลทั้งชุด
 * errors  = ห้ามส่ง ต้องแก้ก่อน
 * warnings = ส่งได้ แต่ต้องให้คนเห็นก่อนกดยืนยัน
 */
function validateMeeting_(meeting, items) {
  var errors = [];
  var warnings = [];
  var people = peopleMap_();
  var minTask = cfgInt_('MIN_TASK_LENGTH');

  var required = { title: 'ชื่อการประชุม', date: 'วันที่', note_taker: 'ผู้จดบันทึก' };
  Object.keys(required).forEach(function (k) {
    if (String(meeting[k] || '').trim() === '') {
      errors.push('meetings แถว ' + meeting._row + ': ยังไม่ได้กรอก ' + required[k] + ' (' + k + ')');
    }
  });

  var mDate = toDate_(meeting.date);
  if (!mDate) {
    errors.push('meetings แถว ' + meeting._row + ': วันที่ประชุมไม่ถูกต้อง ต้องเป็นวันที่จริง ไม่ใช่ข้อความ');
  }

  var attendees = splitNames_(meeting.attendees);
  if (!attendees.length) {
    errors.push('meetings แถว ' + meeting._row + ': ยังไม่ได้กรอกผู้เข้าร่วม (attendees)');
  }
  attendees.forEach(function (n) {
    if (!people[n]) {
      warnings.push('ผู้เข้าร่วม "' + n + '" ไม่มีในชีต people จะไม่ได้รับอีเมล');
    } else if (!people[n].email) {
      warnings.push('ผู้เข้าร่วม "' + n + '" ยังไม่มีอีเมลในชีต people จะไม่ได้รับอีเมล');
    }
  });

  if (!items.length) {
    warnings.push('การประชุมนี้ยังไม่มี action item เลย');
  }

  items.forEach(function (it) {
    var where = 'action_items แถว ' + it._row + ': ';
    var task = String(it.task || '').trim();
    var owner = String(it.owner || '').trim();
    var due = toDate_(it.due_date);

    // บังคับแค่ว่าต้องมีข้อความ ส่วนจะสั้นยาวแค่ไหนเป็นสิทธิ์ของคนจด
    // ถ้าทีมไหนอยากให้เตือนเวลาเขียนสั้นเกิน ตั้ง MIN_TASK_LENGTH เป็นตัวเลขที่ต้องการ (0 = ปิด)
    if (!task) {
      errors.push(where + 'ยังไม่ได้เขียนว่าต้องทำอะไร (task)');
    } else if (minTask > 0 && task.length < minTask) {
      warnings.push(where + 'ชื่องานสั้นมาก (' + task.length + ' ตัวอักษร) คนอ่านสรุปทีหลังอาจไม่เข้าใจ');
    }
    if (!owner) {
      errors.push(where + 'ยังไม่ได้ระบุผู้รับผิดชอบ (owner)');
    } else {
      if (looksLikeMultipleOwners_(owner)) {
        errors.push(where + 'owner "' + owner + '" มีหลายคน ให้แตกเป็นหลายแถว แถวละ 1 คน');
      } else if (!people[owner]) {
        warnings.push(where + 'owner "' + owner + '" ไม่มีในชีต people จะไม่ได้รับเมลรายบุคคล');
      }
    }
    if (!due) {
      errors.push(where + 'ยังไม่ได้ระบุกำหนดเสร็จ (due_date) หรือรูปแบบวันที่ไม่ถูกต้อง');
    } else if (mDate && dayOnly_(due) < dayOnly_(mDate)) {
      errors.push(where + 'กำหนดเสร็จ (' + fmtDate_(due) + ') ย้อนหลังกว่าวันประชุม (' + fmtDate_(mDate) + ')');
    }

    var st = String(it.status || '').trim();
    if (st && ITEM_STATUS.indexOf(st) === -1) {
      warnings.push(where + 'สถานะ "' + st + '" ไม่อยู่ในรายการที่กำหนด (' + ITEM_STATUS.join(', ') + ')');
    }
  });

  return { errors: errors, warnings: warnings };
}

/** รายชื่อผู้รับอีเมลรวม = ผู้เข้าร่วม + ผู้ที่ระบุใน absentees ที่มีอีเมล + CC จาก config */
function recipientsOf_(meeting) {
  var people = peopleMap_();
  var emails = [];
  splitNames_(meeting.attendees).concat(splitNames_(meeting.absentees)).forEach(function (n) {
    var p = people[n];
    if (p && p.email && emails.indexOf(p.email) === -1) emails.push(p.email);
  });
  var cc = String(cfg_('CC_EMAILS') || '')
    .split(',')
    .map(function (x) { return x.trim(); })
    .filter(function (x) { return x.length > 0; });
  return { to: emails, cc: cc };
}
