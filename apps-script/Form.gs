/**
 * Form.gs — ฟอร์มจดประชุมหน้าเดียว (ฝั่งเซิร์ฟเวอร์ของ FormUi.html)
 *
 * เหตุผลที่มีไฟล์นี้: ผู้จดบันทึกไม่ควรต้องกรอกฐานข้อมูลดิบระหว่างประชุม
 * ไม่ควรต้องรู้ว่ามีคอลัมน์อะไร ไม่ควรต้องสลับชีต และไม่ควรต้องเลือก meeting_id ทุกแถว
 * ฟอร์มนี้จึงเป็นหน้าหลักในการใช้งาน ส่วนชีตเป็นแค่ที่เก็บข้อมูลเบื้องหลัง
 */

function openNoteForm() {
  var html = HtmlService.createHtmlOutputFromFile('FormUi')
    .setWidth(1000)
    .setHeight(720);
  ui_().showModalDialog(html, 'จดประชุม');
}

/* ---------------------------------------------------------- ตัวช่วยแปลงวันที่ */

function ymd_(v) {
  var d = toDate_(v);
  return d ? Utilities.formatDate(d, tz_(), 'yyyy-MM-dd') : '';
}

function hm_(v) {
  if (isDate_(v)) return Utilities.formatDate(v, tz_(), 'HH:mm');
  return String(v || '').trim();
}

function ymdhm_(v) {
  var d = toDate_(v);
  return d ? Utilities.formatDate(d, tz_(), "yyyy-MM-dd'T'HH:mm") : '';
}

/** 'YYYY-MM-DD' -> Date (สร้างจากตัวเลขตรง ๆ กันเพี้ยนเรื่อง timezone) */
function parseYmd_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : '';
}

/** 'YYYY-MM-DDTHH:mm' -> Date */
function parseYmdHm_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(s || '').trim());
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : '';
}

/* ------------------------------------------------------------- โหลดข้อมูลเข้าฟอร์ม */

function formInit() {
  var people = [];
  var map = peopleMap_();
  Object.keys(map).forEach(function (n) { if (map[n].active) people.push(n); });

  var rows = readTable_(SHEET.MEETINGS);
  var drafts = rows.filter(function (m) {
    return String(m.status || '').toLowerCase() !== STATUS.SENT;
  });
  var m = drafts.length ? drafts[drafts.length - 1] : null;

  if (!m) {
    // ยังไม่มีร่างค้างอยู่ ให้เปิดฟอร์มเปล่าของวันนี้ รหัสประชุมจะสร้างตอนกดบันทึกครั้งแรก
    return {
      people: people,
      meeting: { meeting_id: '', title: '', date: ymd_(new Date()), start_time: '', end_time: '',
                 location: '', chair: '', note_taker: '', attendees: [], decisions: '',
                 open_issues: '', next_meeting_at: '', sent: false },
      items: []
    };
  }

  var items = getItems_(m.meeting_id).map(function (it) {
    return {
      task: String(it.task || ''),
      owner: String(it.owner || ''),
      due_date: ymd_(it.due_date),
      priority: String(it.priority || 'Medium')
    };
  });

  return {
    people: people,
    meeting: {
      meeting_id: String(m.meeting_id || ''),
      title: String(m.title || ''),
      date: ymd_(m.date),
      start_time: hm_(m.start_time),
      end_time: hm_(m.end_time),
      location: String(m.location || ''),
      chair: String(m.chair || ''),
      note_taker: String(m.note_taker || ''),
      attendees: splitNames_(m.attendees),
      decisions: String(m.decisions || ''),
      open_issues: String(m.open_issues || ''),
      next_meeting_at: ymdhm_(m.next_meeting_at),
      sent: String(m.status || '').toLowerCase() === STATUS.SENT
    },
    items: items
  };
}

/* ------------------------------------------------------------------ บันทึกกลับชีต */

/**
 * บันทึกข้อมูลจากฟอร์มลงชีต
 * @param {Object} p ข้อมูลจากฟอร์ม
 * @param {boolean} check true = ตรวจความถูกต้องแล้วส่งผลกลับไปแสดงในฟอร์มด้วย
 */
function formSave(p, check) {
  var lock = LockService.getDocumentLock();
  lock.waitLock(20000); // กันสองคนกดบันทึกพร้อมกันแล้วเขียนทับกัน
  try {
    var res = upsertMeeting_(p);
    replaceItems_(res.id, p.items || [], p);

    var out = {
      meeting_id: res.id,
      saved_at: Utilities.formatDate(new Date(), tz_(), 'HH:mm:ss'),
      item_count: (p.items || []).length,
      errors: [],
      warnings: []
    };

    if (check) {
      var meeting = readTable_(SHEET.MEETINGS).filter(function (m) {
        return String(m.meeting_id).trim() === res.id;
      })[0];
      var saved = getItems_(res.id);
      var v = validateMeeting_(meeting, saved);
      out.errors = formatIssues_(v.errors, saved);
      out.warnings = formatIssues_(v.warnings, saved);
    }
    return out;
  } finally {
    lock.releaseLock();
  }
}

/**
 * แปลงข้อความตรวจสอบให้อ่านรู้เรื่องในฟอร์ม
 *  - เปลี่ยน "action_items แถว 7" (เลขแถวในชีต) เป็น "งานแถวที่ 2" (ลำดับที่เห็นในฟอร์ม)
 *  - ตัดข้อความซ้ำออก เพราะถ้าผิดแบบเดียวกันหลายแถว การขึ้นซ้ำ ๆ ไม่ได้ช่วยอะไร
 */
function formatIssues_(msgs, items) {
  var pos = {};
  items.forEach(function (it, i) { pos[it._row] = i + 1; });

  var seen = {};
  var out = [];
  msgs.forEach(function (m) {
    var t = String(m)
      .replace(/^action_items แถว (\d+): /, function (all, r) {
        var n = pos[Number(r)];
        return n ? 'งานแถวที่ ' + n + ': ' : 'งานในรายการ: ';
      })
      .replace(/^meetings แถว \d+: /, '');
    if (!seen[t]) {
      seen[t] = true;
      out.push(t);
    }
  });
  return out;
}

/** เก็บไว้เผื่อโค้ดเดิมเรียกใช้ */
function stripRowPrefix_(msg) {
  return formatIssues_([msg], [])[0];
}

function nextMeetingId_() {
  var prefix = 'MOM-' + new Date().getFullYear() + '-';
  var max = 0;
  readTable_(SHEET.MEETINGS).forEach(function (m) {
    var id = String(m.meeting_id || '');
    if (id.indexOf(prefix) === 0) {
      var n = parseInt(id.substring(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  });
  return prefix + ('00' + (max + 1)).slice(-3);
}

/** เขียนแถวประชุม — เก็บค่าที่ฟอร์มไม่ได้แก้ (status, sent_at, image_url, absentees) ไว้เหมือนเดิม */
function upsertMeeting_(p) {
  var sh = sheet_(SHEET.MEETINGS);
  var headers = HEADERS[SHEET.MEETINGS];
  var rows = readTable_(SHEET.MEETINGS);
  var target = null;
  if (p.meeting_id) {
    target = rows.filter(function (m) {
      return String(m.meeting_id).trim() === String(p.meeting_id).trim();
    })[0] || null;
  }
  if (!target) {
    // ฟอร์มไม่ได้ส่งรหัสประชุมมา (เช่น ผู้ใช้รีเฟรชหน้า หรือเปิดสองแท็บ)
    // ให้เขียนทับร่างล่าสุดแทนการสร้างแถวใหม่ ซึ่งจะได้ประชุมซ้ำและทำให้ image_url/สถานะเดิมหลุดหาย
    // เกณฑ์นี้ตรงกับที่ formInit ใช้เลือกร่างมาแสดง จึงเป็นการประชุมเดียวกับที่ผู้ใช้เห็นอยู่
    var drafts = rows.filter(function (m) {
      return String(m.status || '').toLowerCase() !== STATUS.SENT;
    });
    target = drafts.length ? drafts[drafts.length - 1] : null;
  }
  var base = target || {};
  var id = target ? String(target.meeting_id) : (p.meeting_id || nextMeetingId_());

  var vals = {
    meeting_id: id,
    title: String(p.title || '').trim(),
    date: parseYmd_(p.date),
    start_time: String(p.start_time || ''),
    end_time: String(p.end_time || ''),
    location: String(p.location || '').trim(),
    chair: String(p.chair || ''),
    note_taker: String(p.note_taker || ''),
    attendees: (p.attendees || []).join(', '),
    absentees: base.absentees || '',
    decisions: String(p.decisions || '').trim(),
    open_issues: String(p.open_issues || '').trim(),
    next_meeting_at: parseYmdHm_(p.next_meeting_at),
    status: base.status || STATUS.DRAFT,
    sent_at: base.sent_at || '',
    image_url: base.image_url || ''
  };

  var row = target ? target._row : sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, headers.length).setValues([headers.map(function (h) {
    return vals[h] === undefined ? '' : vals[h];
  })]);
  return { row: row, id: id };
}

/**
 * เขียนรายการงานของประชุมนี้ใหม่ทั้งชุด โดยไม่แตะงานของประชุมอื่น
 * สถานะและหมายเหตุเดิมถูกเก็บไว้ด้วยการจับคู่จาก task+owner เพราะฟอร์มไม่ได้แก้สองช่องนี้
 */
function replaceItems_(meetingId, items) {
  var sh = sheet_(SHEET.ITEMS);
  var headers = HEADERS[SHEET.ITEMS];
  var all = readTable_(SHEET.ITEMS);

  var keep = {};
  all.forEach(function (it) {
    if (String(it.meeting_id || '').trim() !== meetingId) return;
    keep[String(it.task || '').trim() + '|' + String(it.owner || '').trim()] = {
      status: it.status || 'Open',
      note: it.note || ''
    };
  });

  var rows = [];
  all.forEach(function (it) {
    if (String(it.meeting_id || '').trim() === meetingId) return; // ของประชุมนี้จะเขียนใหม่ท้ายสุด
    rows.push(headers.map(function (h) { return it[h] === undefined ? '' : it[h]; }));
  });

  items.forEach(function (it, i) {
    var old = keep[String(it.task || '').trim() + '|' + String(it.owner || '').trim()] || {};
    rows.push([
      meetingId + '-A' + (i + 1),
      meetingId,
      String(it.task || '').trim(),
      String(it.owner || ''),
      parseYmd_(it.due_date),
      String(it.priority || 'Medium'),
      old.status || 'Open',
      old.note || ''
    ]);
  });

  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, headers.length).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
}
