/**
 * Image.gs — สร้างรูปสรุปการประชุมฉบับเต็ม สำหรับเซฟไปวางในกลุ่ม LINE
 *
 * Apps Script วาดรูปเองไม่ได้ จึงต้องอ้อมผ่าน Google Slides:
 *   สร้าง/คัดลอกสไลด์ → ใส่ข้อความ → export เป็น PNG ผ่าน Slides API → เก็บลง Drive → ลบสไลด์ชั่วคราว
 *
 * ต้องเปิด Advanced Google Service ชื่อ "Slides" ก่อนใช้ (ดู apps-script/README.md)
 *
 * รูปต้องมีข้อมูลครบเหมือนบันทึกการประชุมจริง ไม่ใช่แค่รายการงาน:
 * ชื่อประชุม / วันเวลา-สถานที่ / ผู้เข้าร่วม / วาระ / มติ / งาน (What-Who-When-ต้องใช้อะไร) / ประเด็นค้าง
 */

/**
 * ความกว้างของผืนผ้าใบ (จุด) — ความสูงคำนวณจากเนื้อหาแต่ละครั้ง
 * Slides export รูปที่ความกว้าง 1600px เสมอ ดังนั้นความกว้างคือสิ่งที่กำหนดว่า
 * ตัวหนังสือจะใหญ่แค่ไหนในไฟล์จริง (12.5pt บนผืนผ้าใบ 480pt ≈ 42px ในรูป)
 */
var CANVAS_W = 480;
var CANVAS_MAX_H = 2400; // กันกรณีประชุมยาวผิดปกติจนได้รูปสูงเกินจะเปิดดูไหว

/**
 * ลองใหม่เมื่อ API ภายนอกสะดุด
 * Slides API และการดาวน์โหลดไฟล์ล้มชั่วคราวได้เป็นปกติ ถ้าไม่ลองซ้ำ ผู้ใช้จะไม่ได้รูป
 * ทั้งที่รอแป๊บเดียวก็ผ่าน — หน่วงเพิ่มขึ้นทุกครั้งเพื่อไม่ไปกระหน่ำซ้ำตอนระบบปลายทางแย่อยู่
 */
function retry_(label, fn) {
  var lastError;
  for (var i = 1; i <= 3; i++) {
    try {
      return fn();
    } catch (e) {
      lastError = e;
      Logger.log('%s ล้มเหลวครั้งที่ %s: %s', label, i, e.message);
      if (i < 3) Utilities.sleep(700 * i);
    }
  }
  throw new Error(label + ' ไม่สำเร็จหลังลอง 3 ครั้ง: ' + String(lastError && lastError.message || lastError));
}

function buildMeetingImage_(meeting, items) {
  var templateId = String(cfg_('SLIDE_TEMPLATE_ID') || '').trim();
  var presId, pres;

  if (templateId) {
    // โหมดเทมเพลต: คัดลอกไฟล์ที่ผู้ใช้ออกแบบเอง แล้วแทนที่ placeholder
    var copy = DriveApp.getFileById(templateId).makeCopy('MOM-temp-' + Date.now());
    presId = copy.getId();
    pres = SlidesApp.openById(presId);
    fillTemplate_(pres, meeting, items);
  } else {
    // โหมดวาดเอง: ไม่ต้องเตรียมไฟล์อะไรล่วงหน้า
    // ขอผืนผ้าใบสูงตามเนื้อหา (รูปที่ export กว้าง 1600px เสมอ ยิ่งสูงตัวหนังสือยิ่งไม่เล็กลง)
    // ถ้า Slides ไม่ยอมกำหนดขนาด จะได้ 16:9 ตามค่าเริ่มต้น ซึ่งเลย์เอาต์มีโหมดรองรับอยู่แล้ว
    var wantH = Math.min(Math.max(layout_(imageModel_(meeting, items), CANVAS_W, 9999, 1).height, 420),
                         CANVAS_MAX_H);
    presId = createPresentation_('MOM-temp-' + Date.now(), CANVAS_W, wantH);
    pres = SlidesApp.openById(presId);
    if (!pres.getSlides().length) pres.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    logInfo_('buildMeetingImage_',
             'ขอผืนผ้าใบ ' + Math.round(CANVAS_W) + 'x' + Math.round(wantH) +
             ' ได้จริง ' + Math.round(pres.getPageWidth()) + 'x' + Math.round(pres.getPageHeight()));
    drawSlide_(pres, meeting, items);
  }
  pres.saveAndClose();

  var pageId = SlidesApp.openById(presId).getSlides()[0].getObjectId();
  var thumb = retry_('แปลงสไลด์เป็นรูป', function () {
    return Slides.Presentations.Pages.getThumbnail(presId, pageId, {
      'thumbnailProperties.mimeType': 'PNG',
      'thumbnailProperties.thumbnailSize': 'LARGE'
    });
  });

  var fileName = String(meeting.meeting_id || 'MOM') + '.png';
  var blob = retry_('ดาวน์โหลดรูป', function () {
    return UrlFetchApp.fetch(thumb.contentUrl).getBlob();
  }).setName(fileName);

  var folder = imageFolder_();
  // ลบไฟล์ชื่อเดียวกันของประชุมนี้ที่สร้างไว้รอบก่อน กันสับสนว่าอันไหนล่าสุด
  var old = folder.getFilesByName(fileName);
  while (old.hasNext()) old.next().setTrashed(true);

  var file = folder.createFile(blob);
  var out = {
    url: file.getUrl(),
    name: fileName,
    folder: folder.getName(),
    // ส่งตัวรูปกลับไปด้วยเพื่อแสดงในหน้าเว็บทันที
    // ลิงก์ของ Drive เป็นหน้าเว็บ ไม่ใช่ไฟล์ภาพ จึงเอาไปใส่ <img src> ตรง ๆ ไม่ได้
    base64: Utilities.base64Encode(blob.getBytes())
  };

  // เก็บกวาดสไลด์ชั่วคราว — ถ้าลบไม่สำเร็จก็ไม่ควรทำให้รูปที่สร้างเสร็จแล้วสูญไป
  try {
    DriveApp.getFileById(presId).setTrashed(true);
  } catch (e) {
    Logger.log('ลบสไลด์ชั่วคราวไม่สำเร็จ (%s): %s', presId, e.message);
  }

  return out;
}

/**
 * สร้างสไลด์เปล่า พยายามให้ได้ขนาดแนวตั้งก่อน
 * ถ้า API ไม่ยอมกำหนดขนาด จะได้สไลด์ 16:9 ปกติ ซึ่งเลย์เอาต์รองรับอยู่แล้ว
 */
function createPresentation_(title, widthPt, heightPt) {
  try {
    var res = Slides.Presentations.create({
      title: title,
      pageSize: {
        width: { magnitude: widthPt, unit: 'PT' },
        height: { magnitude: heightPt, unit: 'PT' }
      }
    });
    if (res && res.presentationId) return res.presentationId;
  } catch (e) {
    Logger.log('สร้างสไลด์แนวตั้งไม่สำเร็จ ใช้ขนาดมาตรฐานแทน: %s', e.message);
  }
  return SlidesApp.create(title).getId();
}

/** โฟลเดอร์เก็บรูป: ใช้ค่าใน config ถ้ามี ถ้าไม่มีก็สร้าง "MOM images" แล้วจำ id ไว้ */
function imageFolder_() {
  var id = String(cfg_('IMAGE_FOLDER_ID') || '').trim();
  if (id) return DriveApp.getFolderById(id);
  var it = DriveApp.getFoldersByName('MOM images');
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder('MOM images');
  props_().setProperty('IMAGE_FOLDER_ID', folder.getId());
  return folder;
}

/* ============================================================ เนื้อหาที่จะใส่ในรูป */

/**
 * รวบข้อมูลประชุมเป็นโครงเดียวที่ตัววาดรูปใช้ต่อได้เลย
 * แยกจากการวาด เพื่อให้เทสต์ตรวจได้ว่า "ข้อมูลครบไหม" โดยไม่ต้องมี Slides
 */
function imageModel_(meeting, items) {
  var sorted = sortItems_(items);
  return {
    title: String(meeting.title || 'สรุปการประชุม').trim(),
    date: fmtDate_(meeting.date),
    time: [fmtTime_(meeting.start_time), fmtTime_(meeting.end_time)].filter(String).join('–'),
    location: String(meeting.location || '').trim(),
    chair: String(meeting.chair || '-').trim(),
    note_taker: String(meeting.note_taker || '-').trim(),
    attendees: splitNames_(meeting.attendees),
    absentees: splitNames_(meeting.absentees),
    agenda: splitLines_(meeting.agenda),
    decisions: splitLines_(meeting.decisions),
    issues: splitLines_(meeting.open_issues),
    next_meeting: toDate_(meeting.next_meeting_at) ? fmtDateTime_(meeting.next_meeting_at) : '',
    meeting_id: String(meeting.meeting_id || '').trim(),
    items: sorted.map(function (it) {
      return {
        task: String(it.task || '').trim(),
        owner: String(it.owner || '-').trim(),
        due: fmtDate_(it.due_date),
        priority: String(it.priority || PRIORITY[1]),
        need: String(it.note || '').trim()
      };
    })
  };
}

function imageFooter_(meeting) {
  var parts = [String(meeting.meeting_id || '')];
  if (String(meeting.note_taker || '').trim()) parts.push('ผู้จดบันทึก: ' + meeting.note_taker);
  if (toDate_(meeting.next_meeting_at)) {
    parts.push('ประชุมครั้งหน้า ' + fmtDateTime_(meeting.next_meeting_at));
  }
  return parts.join('  ·  ');
}

/* ================================================================ วาดรูปลงสไลด์ */

var C = {
  blue: '#1971c2', navy: '#14213d', ink: '#212529', gray: '#495057',
  mute: '#868e96', line: '#e9ecef', tint: '#f4f9ff', band: '#f1f3f5',
  red: '#c92a2a', white: '#ffffff'
};

/** ประมาณจำนวนบรรทัดหลังตัดคำ — วัดข้อความจริงในสไลด์ไม่ได้ จึงประมาณจากจำนวนอักษร */
function lineCount_(text, fontSize, widthPt) {
  var perLine = Math.max(8, Math.floor(widthPt / (fontSize * 0.5)));
  return Math.max(1, Math.ceil(String(text || '').length / perLine));
}

function subLine_(m) {
  var bits = [];
  if (m.date) bits.push('วันที่ ' + m.date);
  if (m.time) bits.push('เวลา ' + m.time);
  if (m.location) bits.push('สถานที่ ' + m.location);
  return bits.join('   ·   ');
}

/**
 * คำนวณตำแหน่งของทุกชิ้นก่อนวาด
 *
 * มีสองโหมดเพราะขนาดผืนผ้าใบที่ได้จริงไม่แน่นอน:
 *  - tall  : ผืนผ้าใบสูง (ถ้า Slides ยอมให้กำหนดขนาด) เรียงลงมาคอลัมน์เดียว
 *  - wide  : ผืนผ้าใบ 16:9 ตามค่าเริ่มต้นของ Slides แบ่งซ้าย/ขวา
 *            เพื่อไม่ให้บรรทัดยาวข้ามจอและได้ใช้ตัวหนังสือใหญ่ขึ้น
 */
function layout_(m, W, H, scale) {
  var s = scale || 1;
  var mode = (H && H / W >= 1.2) ? 'tall' : 'wide';
  var M = (mode === 'tall' ? 28 : 26) * s;
  var f = {
    title: (mode === 'tall' ? 22 : 21) * s,
    sub: (mode === 'tall' ? 12.5 : 11.5) * s,
    roleK: 9 * s,
    roleV: (mode === 'tall' ? 13 : 12) * s,
    head: (mode === 'tall' ? 12 : 11.5) * s,
    body: (mode === 'tall' ? 12.5 : 11.5) * s,
    th: 9.5 * s,
    td: (mode === 'tall' ? 12.5 : 12) * s,
    need: (mode === 'tall' ? 10 : 9.5) * s,
    foot: 9.5 * s
  };
  var plan = { mode: mode, W: W, M: M, inner: W - M * 2, f: f, s: s, parts: [] };
  var y = 0;

  var barH = 9 * s;
  plan.parts.push({ t: 'bar', y: 0, h: barH });
  y += barH + 12 * s;

  var titleH = lineCount_(m.title, f.title, plan.inner) * f.title * 1.3;
  plan.parts.push({ t: 'title', y: y, h: titleH, x: M, w: plan.inner });
  y += titleH + 4 * s;

  var sub = subLine_(m);
  var subH = lineCount_(sub, f.sub, plan.inner) * f.sub * 1.5;
  plan.parts.push({ t: 'text', y: y, h: subH, x: M, w: plan.inner, text: sub, size: f.sub, color: C.gray });
  y += subH + 10 * s;

  var rolesH = 36 * s;
  plan.parts.push({ t: 'roles', y: y, h: rolesH });
  y += rolesH + 12 * s;

  var headerBottom = y;
  var footH = 26 * s;

  if (mode === 'tall') {
    y = infoSections_(plan, m, y, M, plan.inner);
    y = taskSection_(plan, m, y + 6 * s, M, plan.inner);
    y += 14 * s;
    plan.parts.push({ t: 'foot', y: y, h: footH });
    plan.height = y + footH;
    return plan;
  }

  // wide: ซ้าย = บริบทของการประชุม, ขวา = ตารางงาน ซึ่งเป็นส่วนที่ต้องอ่านง่ายที่สุด
  var gap = 22 * s;
  var leftW = Math.round((plan.inner - gap) * 0.42);
  var rightW = plan.inner - gap - leftW;
  var leftEnd = infoSections_(plan, m, headerBottom, M, leftW);
  var rightEnd = taskSection_(plan, m, headerBottom, M + leftW + gap, rightW);

  plan.parts.push({ t: 'vline', y: headerBottom, h: Math.max(leftEnd, rightEnd) - headerBottom,
                    x: M + leftW + gap / 2, w: 1 });

  var bottom = Math.max(leftEnd, rightEnd) + 12 * s;
  plan.parts.push({ t: 'foot', y: Math.max(bottom, H - footH), h: footH });
  plan.height = Math.max(bottom + footH, H || 0);
  return plan;
}

/** ผู้เข้าร่วม / วาระ / มติ / ประเด็นค้าง */
function infoSections_(plan, m, y, x, w) {
  y = section_(plan, y, x, w, 'ผู้เข้าร่วมประชุม (' + m.attendees.length + ' คน)',
               [m.attendees.join(' · ') || '-'].concat(
                 m.absentees.length ? ['ไม่เข้าร่วม: ' + m.absentees.join(' · ')] : []));
  if (m.agenda.length) {
    y = section_(plan, y, x, w, 'วาระการประชุม',
                 m.agenda.map(function (a, i) { return (i + 1) + '. ' + a; }));
  }
  if (m.decisions.length) {
    y = section_(plan, y, x, w, 'มติที่ประชุม', m.decisions.map(function (d) { return '• ' + d; }));
  }
  if (m.issues.length) {
    y = section_(plan, y, x, w, 'ประเด็นค้าง / ความเสี่ยง',
                 m.issues.map(function (o) { return '• ' + o; }));
  }
  return y;
}

/** ตารางสิ่งที่ต้องทำ */
function taskSection_(plan, m, y, x, w) {
  var f = plan.f, s = plan.s;
  y = heading_(plan, y, x, w, 'สิ่งที่ต้องทำ (' + m.items.length + ' รายการ)');

  var col = { n: 22 * s, who: Math.min(96 * s, w * 0.22), due: Math.min(92 * s, w * 0.22) };
  col.task = w - col.n - col.who - col.due;

  var thH = 22 * s;
  plan.parts.push({ t: 'thead', y: y, h: thH, x: x, w: w, col: col });
  y += thH;

  if (!m.items.length) {
    plan.parts.push({ t: 'text', y: y + 6 * s, h: f.td * 1.6, x: x + 6 * s, w: w - 12 * s,
                      text: 'ไม่มีงานที่ต้องติดตามจากการประชุมนี้', size: f.td, color: C.mute });
    return y + f.td * 2.2;
  }

  m.items.forEach(function (it, i) {
    var taskW = col.task - 12 * s;
    var h = lineCount_(it.task, f.td, taskW) * f.td * 1.4 + 12 * s;
    if (it.need) h += lineCount_('ต้องใช้: ' + it.need, f.need, taskW) * f.need * 1.35 + 3 * s;
    plan.parts.push({ t: 'row', y: y, h: h, x: x, w: w, col: col, i: i, item: it });
    y += h;
  });
  return y;
}

/** หัวข้อพร้อมเส้นคั่นใต้ข้อความ (เส้นต้องอยู่ใต้ตัวอักษรจริง ไม่ใช่ขีดทับ) */
function heading_(plan, y, x, w, text) {
  var f = plan.f, s = plan.s;
  y += 12 * s;
  var h = f.head * 1.9;
  plan.parts.push({ t: 'head', y: y, h: h, x: x, w: w, text: text });
  return y + h + 6 * s;
}

function section_(plan, y, x, w, heading, lines) {
  var f = plan.f, s = plan.s;
  y = heading_(plan, y, x, w, heading);
  lines.forEach(function (text) {
    var h = lineCount_(text, f.body, w) * f.body * 1.5;
    plan.parts.push({ t: 'text', y: y, h: h, x: x, w: w, text: text, size: f.body, color: C.ink });
    y += h + 3 * s;
  });
  return y;
}

/* ------------------------------------------------------------------- วาดตามแผน */

function drawPlan_(slide, m, plan, H) {
  var W = plan.W, M = plan.M, f = plan.f, s = plan.s;

  plan.parts.forEach(function (p) {
    if (p.t === 'bar') {
      rect_(slide, 0, p.y, W, p.h, C.blue);

    } else if (p.t === 'title') {
      text_(slide, m.title, p.x, p.y, p.w, p.h, f.title, true, C.navy);

    } else if (p.t === 'text') {
      text_(slide, p.text, p.x, p.y, p.w, p.h, p.size, false, p.color);

    } else if (p.t === 'vline') {
      rect_(slide, p.x, p.y, 1, p.h, C.line);

    } else if (p.t === 'roles') {
      rect_(slide, 0, p.y - 6 * s, W, 1, C.line);
      rect_(slide, 0, p.y + p.h, W, 1, C.line);
      var roles = [['ประธาน', m.chair], ['ผู้จดบันทึก', m.note_taker],
                   ['ผู้เข้าร่วม', m.attendees.length + ' คน']];
      var cw = plan.inner / 3;
      roles.forEach(function (r, i) {
        var x = M + cw * i;
        text_(slide, r[0], x, p.y + 2 * s, cw - 10 * s, f.roleK * 1.6, f.roleK, false, C.mute);
        text_(slide, r[1], x, p.y + 2 * s + f.roleK * 1.5, cw - 10 * s, f.roleV * 1.7, f.roleV, true, C.ink);
        if (i > 0) rect_(slide, x - 10 * s, p.y + 2 * s, 1, p.h - 6 * s, C.line);
      });

    } else if (p.t === 'head') {
      // เส้นคั่นวางไว้ที่ขอบล่างของกล่อง จึงไม่ทับตัวอักษรที่อยู่ด้านบนของกล่อง
      text_(slide, p.text, p.x, p.y, p.w, f.head * 1.5, f.head, true, C.blue);
      rect_(slide, p.x, p.y + p.h - 1.5 * s, p.w, 1.5 * s, '#d0e6fb');

    } else if (p.t === 'thead') {
      var col = p.col;
      rect_(slide, p.x, p.y, p.w, p.h, C.blue);
      var hx = p.x;
      [['#', col.n], ['ทำอะไร', col.task], ['ใคร', col.who], ['ครบกำหนด', col.due]]
        .forEach(function (c) {
          text_(slide, c[0], hx + 5 * s, p.y + 3 * s, c[1] - 7 * s, p.h - 4 * s, f.th, true, C.white);
          hx += c[1];
        });

    } else if (p.t === 'row') {
      var it = p.item, cl = p.col;
      if (p.i % 2 === 1) rect_(slide, p.x, p.y, p.w, p.h, C.tint);
      rect_(slide, p.x, p.y + p.h - 1, p.w, 1, C.line);

      var x = p.x;
      text_(slide, String(p.i + 1), x + 5 * s, p.y + 6 * s, cl.n - 6 * s, f.td * 1.5, f.th, false, C.mute);
      x += cl.n;

      var taskH = lineCount_(it.task, f.td, cl.task - 12 * s) * f.td * 1.4;
      text_(slide, it.task, x + 5 * s, p.y + 5 * s, cl.task - 12 * s, taskH, f.td, true, C.ink);
      if (it.need) {
        text_(slide, 'ต้องใช้: ' + it.need, x + 5 * s, p.y + 5 * s + taskH,
              cl.task - 12 * s, p.h - taskH - 8 * s, f.need, false, C.gray);
      }
      x += cl.task;

      text_(slide, it.owner, x + 5 * s, p.y + 5 * s, cl.who - 7 * s, f.td * 1.7, f.td, true, C.ink);
      x += cl.who;
      text_(slide, it.due, x + 5 * s, p.y + 5 * s, cl.due - 7 * s, f.td * 1.7, f.td, true, C.red);

    } else if (p.t === 'foot') {
      rect_(slide, 0, p.y, W, p.h, C.band);
      var left = m.next_meeting ? 'ประชุมครั้งถัดไป  ' + m.next_meeting : '';
      text_(slide, left, M, p.y + 6 * s, plan.inner * 0.7, p.h, f.foot, true, C.navy);
      text_(slide, m.meeting_id, M + plan.inner * 0.7, p.y + 6 * s, plan.inner * 0.3, p.h,
            f.foot, false, C.gray, SlidesApp.ParagraphAlignment.END);
    }
  });
}

function rect_(slide, l, t, w, h, color) {
  var shape = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, l, t, Math.max(w, 1), Math.max(h, 1));
  shape.getFill().setSolidFill(color);
  shape.getBorder().setTransparent();
  return shape;
}

function text_(slide, str, l, t, w, h, size, bold, color, align) {
  var box = slide.insertTextBox(String(str === '' || str === undefined ? ' ' : str),
                                l, t, Math.max(w, 10), Math.max(h, size * 1.3));
  var range = box.getText();
  range.getTextStyle()
    .setFontSize(size)
    .setForegroundColor(color)
    .setBold(!!bold)
    .setFontFamily('Sarabun');
  range.getParagraphs().forEach(function (para) {
    var ps = para.getRange().getParagraphStyle();
    ps.setLineSpacing(100).setSpaceAbove(0).setSpaceBelow(0);
    if (align) ps.setParagraphAlignment(align);
  });
  return box;
}

/**
 * วาดทั้งหน้า — ปรับตามขนาดผืนผ้าใบที่ได้จริง
 * ถ้าเนื้อหาสูงเกินหน้า จะย่อสเกลก่อน แล้วค่อยตัดจำนวนงานเป็นทางเลือกสุดท้าย
 */
function drawSlide_(pres, meeting, items) {
  var slide = pres.getSlides()[0];
  slide.getPageElements().forEach(function (el) { el.remove(); });
  slide.getBackground().setSolidFill(C.white);

  var W = pres.getPageWidth();
  var H = pres.getPageHeight();
  var model = imageModel_(meeting, items);
  var plan = layout_(model, W, H, 1);

  if (plan.height > H) {
    var scale = Math.max(0.6, H / plan.height);
    plan = layout_(model, W, H, scale);
    var keep = model.items.length;
    while (plan.height > H && keep > 1) {
      keep--;
      var trimmed = imageModel_(meeting, items);
      var rest = trimmed.items.length - keep;
      trimmed.items = trimmed.items.slice(0, keep);
      trimmed.issues = trimmed.issues.concat(['และอีก ' + rest + ' รายการ — ดูรายละเอียดในอีเมล']);
      model = trimmed;
      plan = layout_(model, W, H, scale);
    }
  }

  drawPlan_(slide, model, plan, H);
  return plan;
}

/** ข้อมูลสำหรับโหมดเทมเพลต ({{...}} ในไฟล์สไลด์ของผู้ใช้) */
function imagePayload_(meeting, items) {
  var sorted = sortItems_(items);
  var lim = limitItems_(sorted);
  var lines = lim.shown.map(function (it, i) {
    var s = (i + 1) + '.  ' + String(it.task || '').trim() +
            '\n      ใคร: ' + String(it.owner || '-').trim() + '  ·  ครบ: ' + fmtDate_(it.due_date);
    if (String(it.note || '').trim()) s += '  ·  ต้องใช้: ' + String(it.note).trim();
    return s;
  });
  if (lim.rest) lines.push('และอีก ' + lim.rest + ' รายการ — ดูรายละเอียดในอีเมล');
  if (!lines.length) lines.push('ไม่มีงานที่ต้องติดตามจากการประชุมนี้');

  return {
    title: String(meeting.title || '').trim(),
    headline: meetingHeadline_(meeting),
    count: 'สิ่งที่ต้องทำ (' + sorted.length + ' รายการ)',
    attendees: splitNames_(meeting.attendees).join(', '),
    agenda: splitLines_(meeting.agenda).map(function (a, i) { return (i + 1) + '. ' + a; }).join('\n'),
    decisions: splitLines_(meeting.decisions).map(function (d) { return '• ' + d; }).join('\n'),
    issues: splitLines_(meeting.open_issues).map(function (o) { return '• ' + o; }).join('\n'),
    items: lines.join('\n'),
    footer: imageFooter_(meeting)
  };
}

function fillTemplate_(pres, meeting, items) {
  var p = imagePayload_(meeting, items);
  pres.replaceAllText('{{TITLE}}', p.title);
  pres.replaceAllText('{{HEADLINE}}', p.headline);
  pres.replaceAllText('{{COUNT}}', p.count);
  pres.replaceAllText('{{ATTENDEES}}', p.attendees);
  pres.replaceAllText('{{AGENDA}}', p.agenda);
  pres.replaceAllText('{{DECISIONS}}', p.decisions);
  pres.replaceAllText('{{ISSUES}}', p.issues);
  pres.replaceAllText('{{ITEMS}}', p.items);
  pres.replaceAllText('{{FOOTER}}', p.footer);
}

