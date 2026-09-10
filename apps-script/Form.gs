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

/**
 * เวลาที่บันทึกล่าสุด เก็บเป็น "ข้อความ" ไม่ใช่ Date
 * เพราะถ้าเก็บเป็น Date ชีตอาจปัดเศษมิลลิวินาที ทำให้ค่าที่อ่านกลับมาไม่ตรงกับที่เขียนไป
 * แล้วระบบจะฟ้องว่าชนกันทั้งที่ไม่ได้ชน
 */
function stamp_(v) {
  if (isDate_(v)) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd HH:mm:ss.SSS');
  return String(v === null || v === undefined ? '' : v).trim();
}

/**
 * สร้าง stamp ใหม่ที่ "ต่างจากของเดิมเสมอ"
 * การบันทึกสองครั้งติดกันในมิลลิวินาทีเดียวอาจได้ค่าเท่ากัน ซึ่งจะทำให้ตรวจการชนไม่เจอ
 */
function nextStamp_(prevStamp) {
  var now = new Date();
  var out = stamp_(now);
  var guard = 0;
  while (out === String(prevStamp || '') && guard < 1000) {
    now = new Date(now.getTime() + 1);
    out = stamp_(now);
    guard++;
  }
  return out;
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

/** รายชื่อที่ยังใช้งานอยู่ พร้อมแผนก — ฟอร์มเอาไปจัดกลุ่มเวลาทีมมีคนเยอะ */
function peopleList_() {
  var out = [];
  var map = peopleMap_();
  Object.keys(map).forEach(function (n) {
    if (map[n].active) out.push({ name: n, department: map[n].department || '' });
  });
  return out;
}

function formInit() {
  var people = peopleList_();

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
                 location: '', chair: '', note_taker: '', attendees: [], agenda: '', decisions: '',
                 open_issues: '', next_meeting_at: '', updated_at: '', sent: false },
      items: []
    };
  }

  var items = getItems_(m.meeting_id).map(function (it) {
    return {
      task: String(it.task || ''),
      owner: String(it.owner || ''),
      due_date: ymd_(it.due_date),
      priority: String(it.priority || 'Medium'),
      note: String(it.note || '')
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
      agenda: String(m.agenda || ''),
      decisions: String(m.decisions || ''),
      open_issues: String(m.open_issues || ''),
      next_meeting_at: ymdhm_(m.next_meeting_at),
      updated_at: stamp_(m.updated_at),
      sent: String(m.status || '').toLowerCase() === STATUS.SENT
    },
    items: items
  };
}

/* ------------------------------------------------------------------ บันทึกกลับชีต */

/**
 * ล็อกเอกสารรอบงานที่แตะข้อมูลร่วม
 *
 * ต้องมีตัวช่วยนี้เพราะ LockService ไม่ใช่ reentrant — ถ้าฟังก์ชันที่ถือล็อกอยู่
 * ไปเรียกอีกฟังก์ชันที่ขอล็อกซ้ำ จะค้างจนหมดเวลา ฟังก์ชันภายในจึงต้องเป็นเวอร์ชัน
 * "Core" ที่ไม่ขอล็อกเอง แล้วให้ผู้เรียกชั้นนอกสุดเป็นคนถือล็อกแทน
 */
function withDocumentLock_(fn) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    throw new Error('มีการบันทึกอื่นค้างอยู่ ลองใหม่อีกครั้งใน 2–3 วินาที ' +
                    '(เกิดได้ถ้าเปิดฟอร์มหลายแท็บแล้วกดพร้อมกัน)');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * บันทึกข้อมูลจากฟอร์มลงชีต
 * @param {Object} p ข้อมูลจากฟอร์ม
 * @param {boolean} check true = ตรวจความถูกต้องแล้วส่งผลกลับไปแสดงในฟอร์มด้วย
 */
function formSave(p, check) {
  return withDocumentLock_(function () {
    return formSaveCore_(p, check);
  });
}

/** เนื้อในของ formSave ที่ไม่ขอล็อกเอง — ผู้เรียกต้องถือล็อกมาแล้ว */
function formSaveCore_(p, check) {
  var res = upsertMeeting_(p);
  replaceItems_(res.id, p.items || []);

  var out = {
    meeting_id: res.id,
    updated_at: res.updated_at,
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

  // กันสองแท็บ/สองคนเขียนทับกัน: ฟอร์มถือเวลาที่บันทึกล่าสุดตอนโหลดมาด้วย
  // ถ้าในชีตเปลี่ยนไปแล้วแปลว่ามีคนบันทึกคั่น การเขียนทับจะทำให้งานของอีกฝั่งหายทั้งชุด
  // (ล็อกกันได้แค่การเขียนพร้อมกันเป๊ะ ๆ กันเคสนี้ไม่ได้)
  if (target && p.updated_at !== undefined && !p.force) {
    var current = stamp_(target.updated_at);
    if (current !== String(p.updated_at || '')) {
      throw new Error('CONFLICT: มีการบันทึกประชุมนี้จากที่อื่นหลังจากคุณเปิดฟอร์ม ' +
                      'ถ้าบันทึกทับ งานที่อีกฝั่งเพิ่งใส่ไว้จะหาย');
    }
  }

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
    agenda: String(p.agenda || '').trim(),
    decisions: String(p.decisions || '').trim(),
    open_issues: String(p.open_issues || '').trim(),
    next_meeting_at: parseYmdHm_(p.next_meeting_at),
    status: base.status || STATUS.DRAFT,
    sent_at: base.sent_at || '',
    image_url: base.image_url || '',
    updated_at: nextStamp_(stamp_(base.updated_at))
  };

  var row = target ? target._row : sh.getLastRow() + 1;
  writeRowByHeader_(SHEET.MEETINGS, row, vals);
  return { row: row, id: id, updated_at: vals.updated_at };
}

/**
 * เขียนรายการงานของประชุมนี้ใหม่ โดยแตะเฉพาะแถวของประชุมนี้เท่านั้น
 *
 * เดิมฟังก์ชันนี้ล้างทั้งชีตแล้วเขียนกลับทุกครั้งที่บันทึก ซึ่งแปลว่าการกดบันทึกร่าง
 * หนึ่งครั้งเสี่ยงกับข้อมูลของ "ทุกประชุมที่เคยมี" ถ้าสคริปต์ตายกลางคัน
 *
 * ลำดับที่ใช้คือ เขียนแถวใหม่ต่อท้ายก่อน แล้วค่อยลบแถวเก่า
 * ถ้าพังกลางคันจะได้ข้อมูลซ้ำ ซึ่งการบันทึกครั้งถัดไปจะล้างให้เอง — ดีกว่าข้อมูลหาย
 *
 * สถานะและหมายเหตุเดิมถูกเก็บไว้ด้วยการจับคู่จาก task+owner เพราะฟอร์มไม่ได้แก้ช่องสถานะ
 */
function replaceItems_(meetingId, items) {
  var sh = sheet_(SHEET.ITEMS);
  var mine = readTable_(SHEET.ITEMS).filter(function (it) {
    return String(it.meeting_id || '').trim() === String(meetingId).trim();
  });

  var keep = {};
  mine.forEach(function (it) {
    keep[String(it.task || '').trim() + '|' + String(it.owner || '').trim()] = {
      status: it.status || ITEM_STATUS[0],
      note: it.note || ''
    };
  });

  var rows = (items || []).map(function (it, i) {
    var old = keep[String(it.task || '').trim() + '|' + String(it.owner || '').trim()] || {};
    return {
      item_id: meetingId + '-A' + (i + 1),
      meeting_id: meetingId,
      task: String(it.task || '').trim(),
      owner: String(it.owner || ''),
      due_date: parseYmd_(it.due_date),
      priority: String(it.priority || PRIORITY[1]),
      status: old.status || ITEM_STATUS[0],
      // หมายเหตุมาจากฟอร์มแล้ว ถ้าฟอร์มไม่ได้ส่งมาค่อยใช้ของเดิมในชีต
      note: it.note === undefined ? (old.note || '') : String(it.note || '')
    };
  });

  appendRowsByHeader_(SHEET.ITEMS, rows);
  deleteRowsDesc_(sh, mine.map(function (it) { return it._row; }));
}

/**
 * ลบแถวตามเลขที่ระบุ โดยไล่จากล่างขึ้นบนเพื่อไม่ให้เลขแถวที่เหลือขยับระหว่างลบ
 * และรวบแถวที่ติดกันให้ลบทีเดียว จะได้ไม่เรียก API ทีละแถว
 */
function deleteRowsDesc_(sh, rowNumbers) {
  var rows = (rowNumbers || []).slice().sort(function (a, b) { return b - a; });
  var i = 0;
  while (i < rows.length) {
    var end = rows[i];      // แถวล่างสุดของช่วงนี้
    var count = 1;
    while (i + count < rows.length && rows[i + count] === end - count) count++;
    sh.deleteRows(end - count + 1, count);
    i += count;
  }
  if (rows.length) invalidateTable_(sh.getName());
}
