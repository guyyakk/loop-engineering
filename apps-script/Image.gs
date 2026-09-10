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

/** ขนาดสไลด์แนวตั้งที่อยากได้ (จุด) — อัตราส่วนใกล้ 3:5 เหมาะกับการดูบนมือถือ */
var WANT_W = 420;
var WANT_H = 700;

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
    presId = createPresentation_('MOM-temp-' + Date.now());
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
function createPresentation_(title) {
  try {
    var res = Slides.Presentations.create({
      title: title,
      pageSize: {
        width: { magnitude: WANT_W, unit: 'PT' },
        height: { magnitude: WANT_H, unit: 'PT' }
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

/* ------------------------------------------------------------ เนื้อหาที่จะใส่ในรูป */

/**
 * แปลงข้อมูลประชุมเป็น "บล็อก" ของข้อความ
 * kind 'h' = หัวข้อ (ตัวหนา), 'p' = เนื้อหา, 'i' = บรรทัดย่อยของงาน (เยื้อง)
 * @param {number} maxItems จำนวนงานที่จะแสดง (0 = ทุกงาน) ใช้ตอนต้องตัดให้พอดีหน้า
 */
function imageBlocks_(meeting, items, maxItems) {
  var b = [];
  var sorted = sortItems_(items);
  var shown = (maxItems && maxItems > 0) ? sorted.slice(0, maxItems) : sorted;
  var rest = sorted.length - shown.length;

  var attendees = splitNames_(meeting.attendees);
  if (attendees.length) {
    b.push({ kind: 'h', text: 'ผู้เข้าร่วม (' + attendees.length + ' คน)' });
    b.push({ kind: 'p', text: attendees.join(', ') });
    var absent = splitNames_(meeting.absentees);
    if (absent.length) b.push({ kind: 'p', text: 'ไม่เข้าร่วม: ' + absent.join(', ') });
  }

  var agenda = splitLines_(meeting.agenda);
  if (agenda.length) {
    b.push({ kind: 'h', text: 'วาระการประชุม' });
    agenda.forEach(function (a, i) { b.push({ kind: 'p', text: (i + 1) + '. ' + a }); });
  }

  var decisions = splitLines_(meeting.decisions);
  if (decisions.length) {
    b.push({ kind: 'h', text: 'มติที่ประชุม' });
    decisions.forEach(function (d) { b.push({ kind: 'p', text: '• ' + d }); });
  }

  b.push({ kind: 'h', text: 'สิ่งที่ต้องทำ (' + sorted.length + ' รายการ)' });
  if (!shown.length) {
    b.push({ kind: 'p', text: 'ไม่มีงานที่ต้องติดตามจากการประชุมนี้' });
  }
  shown.forEach(function (it, i) {
    b.push({ kind: 'p', text: (i + 1) + '. ' + String(it.task || '').trim() });
    b.push({
      kind: 'i',
      text: 'ใคร: ' + String(it.owner || '-').trim() +
            '  ·  ครบ: ' + fmtDate_(it.due_date) +
            '  ·  ระดับ: ' + String(it.priority || 'Medium')
    });
    if (String(it.note || '').trim()) {
      b.push({ kind: 'i', text: 'ต้องใช้: ' + String(it.note).trim() });
    }
  });
  if (rest > 0) {
    b.push({ kind: 'i', text: 'และอีก ' + rest + ' รายการ — ดูรายละเอียดในอีเมล' });
  }

  var issues = splitLines_(meeting.open_issues);
  if (issues.length) {
    b.push({ kind: 'h', text: 'ประเด็นค้าง / ความเสี่ยง' });
    issues.forEach(function (o) { b.push({ kind: 'p', text: '• ' + o }); });
  }

  return b;
}

function imageFooter_(meeting) {
  var parts = [String(meeting.meeting_id || '')];
  if (String(meeting.note_taker || '').trim()) parts.push('ผู้จดบันทึก: ' + meeting.note_taker);
  if (toDate_(meeting.next_meeting_at)) {
    parts.push('ประชุมครั้งหน้า ' + fmtDateTime_(meeting.next_meeting_at));
  }
  return parts.join('  ·  ');
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

/* ------------------------------------------------------------------- วาดสไลด์เอง */

/**
 * ประมาณจำนวนบรรทัดหลังตัดคำ เพื่อเลือกขนาดฟอนต์ให้เนื้อหาพอดีหน้า
 * Slides API วัดความกว้างข้อความจริงไม่ได้ จึงประมาณจากจำนวนตัวอักษร
 * ตัวคูณ 0.52 มาจากความกว้างเฉลี่ยของอักษรไทยผสมอังกฤษเทียบกับขนาดฟอนต์
 */
function estimateLines_(blocks, fontSize, textWidth) {
  var perLine = Math.max(16, Math.floor(textWidth / (fontSize * 0.52)));
  var lines = 0;
  blocks.forEach(function (b) {
    lines += Math.max(1, Math.ceil(String(b.text).length / perLine));
    if (b.kind === 'h') lines += 0.5; // หัวข้อมีระยะห่างด้านบน
  });
  return lines;
}

function drawSlide_(pres, meeting, items) {
  var slide = pres.getSlides()[0];
  slide.getPageElements().forEach(function (el) { el.remove(); }); // ล้าง placeholder เริ่มต้น

  var W = pres.getPageWidth();
  var H = pres.getPageHeight();
  var M = Math.round(W * 0.055);
  var textW = W - 2 * M;

  slide.getBackground().setSolidFill('#ffffff');
  var bar = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 0, 0, W, Math.max(5, W * 0.014));
  bar.getFill().setSolidFill('#1971c2');
  bar.getBorder().setTransparent();

  var titleSize = Math.min(26, Math.max(15, W / 22));
  var metaSize = Math.max(9, titleSize * 0.52);
  var footSize = Math.max(7, titleSize * 0.4);

  var y = M * 0.9;
  var titleH = titleSize * 2.6;
  textBox_(slide, String(meeting.title || 'สรุปการประชุม').trim(), M, y, textW, titleH,
           titleSize, true, '#212529');
  y += titleH;

  var metaH = metaSize * 2.4;
  textBox_(slide, meetingHeadline_(meeting), M, y, textW, metaH, metaSize, false, '#495057');
  y += metaH + M * 0.3;

  var footerH = footSize * 2.2;
  var bodyH = H - y - footerH - M * 0.8;

  // เลือกขนาดฟอนต์ที่ใหญ่ที่สุดที่ยังใส่เนื้อหาได้ครบ ถ้าเล็กสุดแล้วยังไม่พอ ค่อยตัดจำนวนงาน
  var blocks = imageBlocks_(meeting, items, 0);
  var size = fitFontSize_(blocks, textW, bodyH);
  if (!size) {
    var total = items.length;
    for (var keep = total - 1; keep >= 1; keep--) {
      blocks = imageBlocks_(meeting, items, keep);
      size = fitFontSize_(blocks, textW, bodyH);
      if (size) break;
    }
    if (!size) { size = 7; }
  }

  drawBlocks_(slide, blocks, M, y, textW, bodyH, size);

  textBox_(slide, imageFooter_(meeting), M, H - footerH - M * 0.4, textW, footerH,
           footSize, false, '#868e96');
}

/** คืนขนาดฟอนต์ที่พอดี หรือ null ถ้าใส่ไม่ลงแม้ขนาดเล็กสุด */
function fitFontSize_(blocks, textW, bodyH) {
  for (var fs = 13; fs >= 7; fs -= 0.5) {
    if (estimateLines_(blocks, fs, textW) * (fs * 1.42) <= bodyH) return fs;
  }
  return null;
}

/**
 * วาดเนื้อหาทั้งหมดในกล่องข้อความเดียว แล้วค่อยไล่ทำหัวข้อให้เป็นตัวหนา
 * ใช้กล่องเดียวเพราะให้ Slides ตัดคำเองแม่นกว่าการคำนวณตำแหน่งทีละบรรทัด
 */
function drawBlocks_(slide, blocks, x, y, w, h, fontSize) {
  var text = blocks.map(function (b) {
    return (b.kind === 'i' ? '     ' : '') + b.text;
  }).join('\n');

  var box = slide.insertTextBox(text || ' ', x, y, w, h);
  var range = box.getText();
  range.getTextStyle()
    .setFontSize(fontSize)
    .setForegroundColor('#212529')
    .setBold(false)
    .setFontFamily('Sarabun');

  // ทำหัวข้อให้เด่นขึ้น โดยหาช่วงตัวอักษรของแต่ละบรรทัดตามลำดับที่ประกอบไว้
  var pos = 0;
  blocks.forEach(function (b) {
    var line = (b.kind === 'i' ? '     ' : '') + b.text;
    if (b.kind === 'h') {
      range.getRange(pos, pos + line.length).getTextStyle()
        .setBold(true)
        .setForegroundColor('#1971c2')
        .setFontSize(fontSize * 1.1);
    } else if (b.kind === 'i') {
      range.getRange(pos, pos + line.length).getTextStyle()
        .setForegroundColor('#5c6670');
    }
    pos += line.length + 1; // +1 คือตัวขึ้นบรรทัดใหม่
  });

  range.getParagraphs().forEach(function (para) {
    para.getRange().getParagraphStyle().setLineSpacing(105).setSpaceBelow(1);
  });
  return box;
}

function textBox_(slide, text, left, top, width, height, size, bold, color) {
  var box = slide.insertTextBox(text || ' ', left, top, width, height);
  var style = box.getText().getTextStyle();
  style.setFontSize(size).setForegroundColor(color).setBold(!!bold);
  style.setFontFamily('Sarabun'); // ฟอนต์ไทยอ่านง่าย ถ้าไม่มีในบัญชี Google จะ fallback ให้เอง
  box.getText().getParagraphs().forEach(function (para) {
    para.getRange().getParagraphStyle().setLineSpacing(110).setSpaceBelow(2);
  });
  return box;
}
