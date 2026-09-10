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
    // คำนวณความสูงที่เนื้อหาต้องใช้ก่อน แล้วค่อยสั่งสร้างผืนผ้าใบเท่านั้น
    // รูปที่ export ออกมากว้าง 1600px เสมอ ผืนผ้าใบยิ่งสูงตัวหนังสือจึงไม่เล็กลง
    var needH = layout_(imageModel_(meeting, items), CANVAS_W, 1).height;
    presId = createPresentation_('MOM-temp-' + Date.now(), CANVAS_W,
                                 Math.min(Math.max(needH, 420), CANVAS_MAX_H));
    pres = SlidesApp.openById(presId);
    if (!pres.getSlides().length) pres.appendSlide(SlidesApp.PredefinedLayout.BLANK);
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
  mute: '#868e96', line: '#e9ecef', tint: '#f8fbff', band: '#f1f3f5',
  red: '#c92a2a', redBg: '#fff0f0', white: '#ffffff'
};

/** ประมาณจำนวนบรรทัดหลังตัดคำ — วัดข้อความจริงในสไลด์ไม่ได้ จึงประมาณจากจำนวนอักษร */
function lineCount_(text, fontSize, widthPt) {
  var perLine = Math.max(8, Math.floor(widthPt / (fontSize * 0.5)));
  return Math.max(1, Math.ceil(String(text || '').length / perLine));
}

/**
 * คำนวณความสูงที่เนื้อหาต้องใช้ และตำแหน่งของทุกชิ้น
 * แยกออกมาเพื่อให้รู้ความสูงก่อนสร้างสไลด์ จะได้สั่งขนาดผืนผ้าใบให้พอดีเนื้อหา
 * (รูปที่ export ออกมากว้าง 1600px เสมอ ผืนผ้าใบยิ่งสูงตัวหนังสือจึงไม่เล็กลง)
 */
function layout_(m, W, scale) {
  var s = scale || 1;
  var M = 28 * s;
  var inner = W - M * 2;
  var f = {
    title: 22 * s, sub: 12.5 * s, roleK: 9.5 * s, roleV: 13 * s,
    head: 12 * s, body: 12.5 * s, th: 10.5 * s, td: 13 * s, need: 10 * s,
    foot: 10.5 * s
  };
  var plan = { W: W, M: M, inner: inner, f: f, s: s, parts: [] };
  var y = 0;

  var barH = 10 * s;
  plan.parts.push({ t: 'bar', y: 0, h: barH });
  y += barH + 14 * s;

  var titleH = lineCount_(m.title, f.title, inner) * f.title * 1.25;
  plan.parts.push({ t: 'title', y: y, h: titleH });
  y += titleH + 8 * s;

  var sub = subLine_(m);
  var subH = lineCount_(sub, f.sub, inner) * f.sub * 1.3;
  plan.parts.push({ t: 'sub', y: y, h: subH, text: sub });
  y += subH + 12 * s;

  var rolesH = 40 * s;
  plan.parts.push({ t: 'roles', y: y, h: rolesH });
  y += rolesH;

  y = section_(plan, y, 'ผู้เข้าร่วมประชุม (' + m.attendees.length + ' คน)',
               [m.attendees.join(' · ') || '-'].concat(
                 m.absentees.length ? ['ไม่เข้าร่วม: ' + m.absentees.join(' · ')] : []));
  if (m.agenda.length) {
    y = section_(plan, y, 'วาระการประชุม',
                 m.agenda.map(function (a, i) { return (i + 1) + '. ' + a; }));
  }
  if (m.decisions.length) {
    y = section_(plan, y, 'มติที่ประชุม', m.decisions.map(function (d) { return '• ' + d; }));
  }

  // ตารางงาน — ส่วนที่ต้องอ่านง่ายที่สุด
  y += 16 * s;
  plan.parts.push({ t: 'head', y: y, h: f.head * 1.4, text: 'สิ่งที่ต้องทำ (' + m.items.length + ' รายการ)' });
  y += f.head * 1.4 + 8 * s;

  var col = {
    n: 26 * s,
    who: 92 * s,
    due: 104 * s
  };
  col.task = inner - col.n - col.who - col.due;
  plan.col = col;

  var thH = 24 * s;
  plan.parts.push({ t: 'thead', y: y, h: thH });
  y += thH;

  if (!m.items.length) {
    var emptyH = f.td * 2;
    plan.parts.push({ t: 'empty', y: y, h: emptyH });
    y += emptyH;
  }
  m.items.forEach(function (it, i) {
    var taskW = col.task - 12 * s;
    var lines = lineCount_(it.task + '   ' + it.priority, f.td, taskW);
    var h = lines * f.td * 1.35 + 14 * s;
    if (it.need) h += lineCount_('ต้องใช้: ' + it.need, f.need, taskW) * f.need * 1.3 + 4 * s;
    plan.parts.push({ t: 'row', y: y, h: h, i: i, item: it });
    y += h;
  });

  if (m.issues.length) {
    y = section_(plan, y + 8 * s, 'ประเด็นค้าง / ความเสี่ยง',
                 m.issues.map(function (o) { return '• ' + o; }));
  }

  y += 16 * s;
  var footH = 30 * s;
  plan.parts.push({ t: 'foot', y: y, h: footH });
  y += footH;

  plan.height = y;
  return plan;
}

function subLine_(m) {
  var bits = [];
  if (m.date) bits.push('วันที่ ' + m.date);
  if (m.time) bits.push('เวลา ' + m.time);
  if (m.location) bits.push('สถานที่ ' + m.location);
  return bits.join('   ·   ');
}

/** เพิ่มหัวข้อ + เนื้อหาลงในแผน แล้วคืนตำแหน่ง y ถัดไป */
function section_(plan, y, heading, lines) {
  var f = plan.f, s = plan.s;
  y += 14 * s;
  plan.parts.push({ t: 'head', y: y, h: f.head * 1.4, text: heading });
  y += f.head * 1.4 + 6 * s;
  lines.forEach(function (text) {
    var h = lineCount_(text, f.body, plan.inner) * f.body * 1.45;
    plan.parts.push({ t: 'line', y: y, h: h, text: text });
    y += h + 3 * s;
  });
  return y;
}

/** วาดตามแผนที่คำนวณไว้ */
function drawPlan_(slide, m, plan) {
  var W = plan.W, M = plan.M, f = plan.f, s = plan.s, col = plan.col;

  plan.parts.forEach(function (p) {
    if (p.t === 'bar') {
      rect_(slide, 0, p.y, W, p.h, C.blue);

    } else if (p.t === 'title') {
      text_(slide, m.title, M, p.y, plan.inner, p.h, f.title, true, C.navy);

    } else if (p.t === 'sub') {
      text_(slide, p.text, M, p.y, plan.inner, p.h, f.sub, false, C.gray);

    } else if (p.t === 'roles') {
      rect_(slide, 0, p.y, W, 1, C.line);
      rect_(slide, 0, p.y + p.h, W, 1, C.line);
      var roles = [
        ['ประธาน', m.chair],
        ['ผู้จดบันทึก', m.note_taker],
        ['ผู้เข้าร่วม', m.attendees.length + ' คน']
      ];
      var cw = plan.inner / 3;
      roles.forEach(function (r, i) {
        var x = M + cw * i;
        text_(slide, r[0], x, p.y + 6 * s, cw - 6 * s, f.roleK * 1.4, f.roleK, false, C.mute);
        text_(slide, r[1], x, p.y + 6 * s + f.roleK * 1.4, cw - 6 * s, f.roleV * 1.5, f.roleV, true, C.ink);
        if (i > 0) rect_(slide, x - 8 * s, p.y + 6 * s, 1, p.h - 12 * s, C.line);
      });

    } else if (p.t === 'head') {
      text_(slide, p.text, M, p.y, plan.inner, p.h, f.head, true, C.blue);
      rect_(slide, M, p.y + p.h + 1 * s, plan.inner, 1.5 * s, '#e7f5ff');

    } else if (p.t === 'line') {
      text_(slide, p.text, M, p.y, plan.inner, p.h, f.body, false, C.ink);

    } else if (p.t === 'thead') {
      rect_(slide, M, p.y, plan.inner, p.h, C.blue);
      var hx = M;
      [['#', col.n], ['ทำอะไร', col.task], ['ใคร', col.who], ['ครบกำหนด', col.due]]
        .forEach(function (c) {
          text_(slide, c[0], hx + 6 * s, p.y + 4 * s, c[1] - 8 * s, p.h - 6 * s, f.th, true, C.white);
          hx += c[1];
        });

    } else if (p.t === 'empty') {
      text_(slide, 'ไม่มีงานที่ต้องติดตามจากการประชุมนี้', M + 6 * s, p.y + 4 * s,
            plan.inner - 12 * s, p.h, f.td, false, C.mute);

    } else if (p.t === 'row') {
      var it = p.item;
      if (p.i % 2 === 1) rect_(slide, M, p.y, plan.inner, p.h, C.tint);
      rect_(slide, M, p.y + p.h - 1, plan.inner, 1, C.line);

      var x = M;
      text_(slide, String(p.i + 1), x + 6 * s, p.y + 7 * s, col.n - 8 * s, f.td * 1.4, f.th, false, C.mute);
      x += col.n;

      var taskText = it.task + (it.priority === PRIORITY[0] ? '   [' + it.priority + ']' : '');
      var taskH = lineCount_(taskText, f.td, col.task - 12 * s) * f.td * 1.35;
      text_(slide, taskText, x + 6 * s, p.y + 6 * s, col.task - 12 * s, taskH, f.td, true, C.ink);
      if (it.need) {
        text_(slide, 'ต้องใช้: ' + it.need, x + 6 * s, p.y + 6 * s + taskH,
              col.task - 12 * s, p.h - taskH - 8 * s, f.need, false, C.gray);
      }
      x += col.task;

      text_(slide, it.owner, x + 6 * s, p.y + 6 * s, col.who - 8 * s, f.td * 1.5, f.td, true, C.ink);
      x += col.who;
      text_(slide, it.due, x + 6 * s, p.y + 6 * s, col.due - 8 * s, f.td * 1.5, f.td, true, C.red);

    } else if (p.t === 'foot') {
      rect_(slide, 0, p.y, W, p.h, C.band);
      var left = m.next_meeting ? 'ประชุมครั้งถัดไป  ' + m.next_meeting : '';
      text_(slide, left, M, p.y + 8 * s, plan.inner * 0.7, p.h, f.foot, true, C.navy);
      text_(slide, m.meeting_id, M + plan.inner * 0.7, p.y + 8 * s, plan.inner * 0.3, p.h,
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
                                l, t, Math.max(w, 10), Math.max(h, size * 1.2));
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
 * วาดทั้งหน้า — ปรับตัวตามขนาดผืนผ้าใบที่ได้จริง
 * ถ้า API ไม่ยอมกำหนดขนาด เราจะได้สไลด์ 16:9 ซึ่งเตี้ยกว่าที่เนื้อหาต้องการมาก
 * จึงย่อสเกลลงให้พอดี และถ้าย่อจนเล็กเกินอ่านแล้วยังไม่พอ ค่อยตัดจำนวนงาน
 */
function drawSlide_(pres, meeting, items) {
  var slide = pres.getSlides()[0];
  slide.getPageElements().forEach(function (el) { el.remove(); });
  slide.getBackground().setSolidFill(C.white);

  var W = pres.getPageWidth();
  var H = pres.getPageHeight();
  var model = imageModel_(meeting, items);

  var plan = layout_(model, W, 1);
  if (plan.height > H) {
    var scale = Math.max(0.62, H / plan.height);
    plan = layout_(model, W, scale);

    // ย่อแล้วยังไม่พอ: ตัดจำนวนงานลงทีละรายการ แล้วบอกจำนวนที่เหลือแทน
    var keep = model.items.length;
    while (plan.height > H && keep > 1) {
      keep--;
      var trimmed = imageModel_(meeting, items);
      var rest = trimmed.items.length - keep;
      trimmed.items = trimmed.items.slice(0, keep);
      trimmed.issues = trimmed.issues.concat(['และอีก ' + rest + ' รายการ — ดูรายละเอียดในอีเมล']);
      model = trimmed;
      plan = layout_(model, W, scale);
    }
  }

  drawPlan_(slide, model, plan);
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

