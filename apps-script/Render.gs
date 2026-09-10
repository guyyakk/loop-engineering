/**
 * Render.gs — แปลงข้อมูลประชุมเป็นข้อความ/HTML สำหรับอีเมล รูปภาพ และการก๊อปวางใน LINE
 */

var TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function fmtDate_(v) {
  var d = toDate_(v);
  if (!d) return '';
  var year = d.getFullYear() + (cfgBool_('USE_BUDDHIST_YEAR') ? 543 : 0);
  return d.getDate() + ' ' + TH_MONTH[d.getMonth()] + ' ' + year;
}

function fmtDateTime_(v) {
  var d = toDate_(v);
  if (!d) return '';
  return fmtDate_(d) + ' ' + Utilities.formatDate(d, tz_(), 'HH:mm');
}

/** ช่องเวลาในชีตเก็บเป็น Date หรือข้อความก็ได้ */
function fmtTime_(v) {
  if (isDate_(v)) return Utilities.formatDate(v, tz_(), 'HH:mm');
  return String(v || '').trim();
}

function esc_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** จำกัดจำนวนงานที่แสดง — MAX_ITEMS_IN_IMAGE = 0 แปลว่าไม่จำกัด */
function limitItems_(sorted) {
  var max = cfgInt_('MAX_ITEMS_IN_IMAGE');
  if (!max || max <= 0 || sorted.length <= max) return { shown: sorted, rest: 0 };
  return { shown: sorted.slice(0, max), rest: sorted.length - max };
}

function sortItems_(items) {
  return items.slice().sort(function (a, b) {
    var da = toDate_(a.due_date), db = toDate_(b.due_date);
    if (da && db && da.getTime() !== db.getTime()) return da - db;
    if (da && !db) return -1;
    if (!da && db) return 1;
    var pa = PRIORITY.indexOf(String(a.priority || 'Medium'));
    var pb = PRIORITY.indexOf(String(b.priority || 'Medium'));
    return (pa < 0 ? 1 : pa) - (pb < 0 ? 1 : pb);
  });
}

function meetingHeadline_(meeting) {
  var parts = [fmtDate_(meeting.date)];
  var t = [fmtTime_(meeting.start_time), fmtTime_(meeting.end_time)].filter(String).join('–');
  if (t) parts.push(t);
  if (String(meeting.location || '').trim()) parts.push(String(meeting.location).trim());
  return parts.join(' · ');
}

function subjectOf_(meeting, items) {
  return '[MOM] ' + String(meeting.title || '').trim() + ' — ' + fmtDate_(meeting.date) +
         ' (' + items.length + ' action items)';
}

function splitLines_(s) {
  return String(s || '')
    .split(/\n/)
    .map(function (x) { return x.trim(); })
    .filter(function (x) { return x.length > 0; });
}

/* ---------------------------------------------------------------- อีเมล HTML */

function itemsTableHtml_(items) {
  if (!items.length) return '<p style="color:#666">ไม่มี action item ในการประชุมนี้</p>';
  var th = 'style="text-align:left;padding:8px 10px;background:#f1f3f5;border:1px solid #dee2e6;font-size:13px"';
  var td = 'style="padding:8px 10px;border:1px solid #dee2e6;font-size:14px;vertical-align:top"';
  var tdDue = 'style="padding:8px 10px;border:1px solid #dee2e6;font-size:14px;vertical-align:top;' +
              'color:#c92a2a;font-weight:bold"';
  var today = dayOnly_(new Date());
  var rows = items.map(function (it, i) {
    // งานที่เลยกำหนดและยังไม่ Done ให้เน้นสีแดง จะได้เห็นตั้งแต่เปิดอีเมล
    var due = toDate_(it.due_date);
    var overdue = due && dayOnly_(due) < today && String(it.status || '') !== 'Done';
    return '<tr>' +
      '<td ' + td + '>' + (i + 1) + '</td>' +
      '<td ' + td + '>' + esc_(it.task) + (String(it.note || '').trim()
        ? '<div style="color:#868e96;font-size:12px;margin-top:4px">' + esc_(it.note) + '</div>' : '') + '</td>' +
      '<td ' + td + '><b>' + esc_(it.owner) + '</b></td>' +
      '<td ' + (overdue ? tdDue : td) + '>' + esc_(fmtDate_(it.due_date)) + '</td>' +
      '<td ' + td + '>' + esc_(it.priority || '') + '</td>' +
      '<td ' + td + '>' + esc_(it.status || 'Open') + '</td>' +
      '</tr>';
  }).join('');
  return '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin:8px 0 16px">' +
    '<tr><th ' + th + '>#</th><th ' + th + '>สิ่งที่ต้องทำ</th><th ' + th + '>ผู้รับผิดชอบ</th>' +
    '<th ' + th + '>กำหนดเสร็จ</th><th ' + th + '>ความสำคัญ</th><th ' + th + '>สถานะ</th></tr>' +
    rows + '</table>';
}

function bulletsHtml_(text) {
  var lines = splitLines_(text);
  if (!lines.length) return '';
  return '<ul style="margin:4px 0 16px;padding-left:20px">' +
    lines.map(function (l) { return '<li style="margin:4px 0">' + esc_(l) + '</li>'; }).join('') +
    '</ul>';
}

function buildEmailHtml_(meeting, items) {
  var sorted = sortItems_(items);
  var h2 = 'style="font-size:15px;margin:20px 0 4px;color:#212529"';
  var html =
    '<div style="font-family:Arial,\'Helvetica Neue\',sans-serif;color:#212529;max-width:760px">' +
    '<div style="border-left:4px solid #1971c2;padding-left:12px;margin-bottom:16px">' +
      '<div style="font-size:20px;font-weight:bold">' + esc_(meeting.title) + '</div>' +
      '<div style="color:#495057;font-size:14px;margin-top:4px">' + esc_(meetingHeadline_(meeting)) + '</div>' +
      '<div style="color:#868e96;font-size:12px;margin-top:2px">' + esc_(meeting.meeting_id) +
        (String(meeting.chair || '').trim() ? ' · ประธาน: ' + esc_(meeting.chair) : '') +
        (String(meeting.note_taker || '').trim() ? ' · ผู้จดบันทึก: ' + esc_(meeting.note_taker) : '') +
      '</div>' +
    '</div>';

  if (String(meeting.attendees || '').trim()) {
    html += '<div ' + h2 + '><b>ผู้เข้าร่วม</b></div>' +
      '<div style="font-size:14px">' + esc_(meeting.attendees) + '</div>';
    if (String(meeting.absentees || '').trim()) {
      html += '<div style="font-size:13px;color:#868e96;margin-top:2px">ไม่เข้าร่วม: ' +
        esc_(meeting.absentees) + '</div>';
    }
  }

  if (String(meeting.agenda || '').trim()) {
    html += '<div ' + h2 + '><b>วาระการประชุม</b></div>' + bulletsHtml_(meeting.agenda);
  }

  if (String(meeting.decisions || '').trim()) {
    html += '<div ' + h2 + '><b>มติที่ประชุม</b></div>' + bulletsHtml_(meeting.decisions);
  }

  html += '<div ' + h2 + '><b>สิ่งที่ต้องทำ (' + sorted.length + ' รายการ เรียงตามกำหนดเสร็จ)</b></div>' +
    itemsTableHtml_(sorted);

  if (String(meeting.open_issues || '').trim()) {
    html += '<div ' + h2 + '><b>ประเด็นค้าง / ความเสี่ยง</b></div>' + bulletsHtml_(meeting.open_issues);
  }

  if (toDate_(meeting.next_meeting_at)) {
    html += '<div ' + h2 + '><b>ประชุมครั้งถัดไป</b></div>' +
      '<div style="font-size:14px">' + esc_(fmtDateTime_(meeting.next_meeting_at)) + '</div>';
  }

  html += '<div style="margin-top:24px;padding-top:12px;border-top:1px solid #dee2e6;color:#868e96;font-size:12px">' +
    'สรุปฉบับนี้สร้างอัตโนมัติจากชีต MOM หากพบข้อมูลคลาดเคลื่อน กรุณาแจ้ง ' +
    esc_(meeting.note_taker || 'ผู้จดบันทึก') + ' ภายใน 24 ชั่วโมง' +
    '</div></div>';
  return html;
}

/** อีเมลรายบุคคล: เห็นเฉพาะงานของตัวเอง */
function buildPersonalEmailHtml_(meeting, ownerName, ownerItems) {
  return '<div style="font-family:Arial,sans-serif;color:#212529;max-width:640px">' +
    '<p style="font-size:14px">สวัสดีครับ/ค่ะ คุณ' + esc_(ownerName) + '</p>' +
    '<p style="font-size:14px">จากการประชุม <b>' + esc_(meeting.title) + '</b> เมื่อ ' +
      esc_(fmtDate_(meeting.date)) + ' คุณมีงานที่ต้องทำ ' + ownerItems.length + ' รายการ ดังนี้</p>' +
    itemsTableHtml_(sortItems_(ownerItems)) +
    '<p style="font-size:13px;color:#868e96">อีเมลฉบับนี้ตัดเฉพาะงานของคุณจากสรุปการประชุมฉบับเต็มที่ส่งให้ทุกคนแล้ว</p>' +
    '</div>';
}

/* ------------------------------------------- ข้อความสั้นสำหรับก๊อปวางใน LINE */

function buildLineText_(meeting, items) {
  var sorted = sortItems_(items);
  var lim = limitItems_(sorted);
  var lines = [];
  lines.push('📋 สรุปประชุม: ' + String(meeting.title || '').trim());
  lines.push('🗓 ' + meetingHeadline_(meeting));

  var attendees = splitNames_(meeting.attendees);
  if (attendees.length) {
    lines.push('👥 ผู้เข้าร่วม (' + attendees.length + '): ' + attendees.join(', '));
  }
  lines.push('');

  var agenda = splitLines_(meeting.agenda);
  if (agenda.length) {
    lines.push('📑 วาระ');
    agenda.forEach(function (a, i) { lines.push((i + 1) + '. ' + a); });
    lines.push('');
  }

  var decisions = splitLines_(meeting.decisions);
  if (decisions.length) {
    lines.push('✅ มติที่ประชุม');
    decisions.forEach(function (d) { lines.push('• ' + d); });
    lines.push('');
  }

  lines.push('📌 งานที่ต้องทำ (' + sorted.length + ')');
  lim.shown.forEach(function (it, i) {
    lines.push((i + 1) + '. ' + String(it.owner).trim() + ' — ' + String(it.task).trim() +
      ' · ครบ ' + fmtDate_(it.due_date));
    if (String(it.note || '').trim()) {
      lines.push('    ต้องใช้: ' + String(it.note).trim());
    }
  });
  if (lim.rest) {
    lines.push('…และอีก ' + lim.rest + ' รายการ ดูรายละเอียดในอีเมล');
  }

  var openIssues = splitLines_(meeting.open_issues);
  if (openIssues.length) {
    lines.push('');
    lines.push('⏳ ประเด็นค้าง');
    openIssues.forEach(function (o) { lines.push('• ' + o); });
  }

  if (toDate_(meeting.next_meeting_at)) {
    lines.push('');
    lines.push('📅 ประชุมครั้งหน้า ' + fmtDateTime_(meeting.next_meeting_at));
  }
  var link = String(cfg_('SUMMARY_LINK') || '').trim();
  if (link) lines.push('🔗 สรุปฉบับเต็ม: ' + link);

  return lines.join('\n');
}
