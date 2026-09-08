/**
 * Image.gs — สร้างรูป PNG สรุปการประชุม สำหรับเซฟไปวางในกลุ่ม LINE
 *
 * Apps Script วาดรูปเองไม่ได้ จึงต้องอ้อมผ่าน Google Slides:
 *   สร้าง/คัดลอกสไลด์ → ใส่ข้อความ → export เป็น PNG ผ่าน Slides API → เก็บลง Drive → ลบสไลด์ชั่วคราว
 *
 * ต้องเปิด Advanced Google Service ชื่อ "Slides" ก่อนใช้ (ดู apps-script/README.md ขั้นที่ 4)
 */

var SLIDE_W = 720; // จุด (points) ของสไลด์ 16:9 มาตรฐาน = 10 นิ้ว
var SLIDE_H = 405;

function buildMeetingImage_(meeting, items) {
  var templateId = String(cfg_('SLIDE_TEMPLATE_ID') || '').trim();
  var presId, pres;

  if (templateId) {
    // โหมดเทมเพลต: คัดลอกไฟล์ที่ผู้ใช้ออกแบบเอง (เช่น แนวตั้ง 1080x1350) แล้วแทนที่ placeholder
    var copy = DriveApp.getFileById(templateId).makeCopy('MOM-temp-' + Date.now());
    presId = copy.getId();
    pres = SlidesApp.openById(presId);
    fillTemplate_(pres, meeting, items);
  } else {
    // โหมดวาดเอง: ไม่ต้องเตรียมไฟล์อะไรล่วงหน้า ได้สไลด์แนวนอน 16:9
    pres = SlidesApp.create('MOM-temp-' + Date.now());
    presId = pres.getId();
    drawSlide_(pres, meeting, items);
  }
  pres.saveAndClose();

  var pageId = SlidesApp.openById(presId).getSlides()[0].getObjectId();
  var thumb = Slides.Presentations.Pages.getThumbnail(presId, pageId, {
    'thumbnailProperties.mimeType': 'PNG',
    'thumbnailProperties.thumbnailSize': 'LARGE'
  });

  var fileName = String(meeting.meeting_id || 'MOM') + '.png';
  var blob = UrlFetchApp.fetch(thumb.contentUrl).getBlob().setName(fileName);

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
  // (ถ้า throw ตรงนี้ ผู้เรียกจะไม่ได้ลิงก์ ทั้งที่ไฟล์ PNG ถูกสร้างขึ้นจริงแล้ว)
  try {
    DriveApp.getFileById(presId).setTrashed(true);
  } catch (e) {
    Logger.log('ลบสไลด์ชั่วคราวไม่สำเร็จ (%s): %s', presId, e.message);
  }

  return out;
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

/** เนื้อหาที่ใส่ลงรูป — ตัดให้เหลือเท่าที่อ่านออกบนมือถือ */
function imagePayload_(meeting, items) {
  var sorted = sortItems_(items);
  var max = cfgInt_('MAX_ITEMS_IN_IMAGE');
  var shown = sorted.slice(0, max);
  var lines = shown.map(function (it, i) {
    return (i + 1) + '.  ' + String(it.owner).trim() + '  —  ' + String(it.task).trim() +
           '   (ครบ ' + fmtDate_(it.due_date) + ')';
  });
  if (sorted.length > max) {
    lines.push('และอีก ' + (sorted.length - max) + ' รายการ — ดูรายละเอียดในอีเมล');
  }
  if (!lines.length) lines.push('ไม่มี action item ในการประชุมนี้');

  var footer = [String(meeting.meeting_id || '')];
  if (toDate_(meeting.next_meeting_at)) {
    footer.push('ประชุมครั้งหน้า ' + fmtDateTime_(meeting.next_meeting_at));
  }

  return {
    title: String(meeting.title || '').trim(),
    headline: meetingHeadline_(meeting),
    count: 'สิ่งที่ต้องทำ (' + sorted.length + ' รายการ)',
    items: lines.join('\n'),
    footer: footer.join('  ·  ')
  };
}

/** โหมดเทมเพลต: แทนที่ {{...}} ในสไลด์ที่ผู้ใช้ออกแบบไว้ */
function fillTemplate_(pres, meeting, items) {
  var p = imagePayload_(meeting, items);
  pres.replaceAllText('{{TITLE}}', p.title);
  pres.replaceAllText('{{HEADLINE}}', p.headline);
  pres.replaceAllText('{{COUNT}}', p.count);
  pres.replaceAllText('{{ITEMS}}', p.items);
  pres.replaceAllText('{{FOOTER}}', p.footer);
}

/** โหมดวาดเอง: จัดวางกล่องข้อความบนสไลด์เปล่า */
function drawSlide_(pres, meeting, items) {
  var p = imagePayload_(meeting, items);
  var slide = pres.getSlides()[0];
  slide.getPageElements().forEach(function (el) { el.remove(); }); // ล้าง placeholder เริ่มต้น

  slide.getBackground().setSolidFill('#ffffff');

  var bar = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 0, 0, SLIDE_W, 8);
  bar.getFill().setSolidFill('#1971c2');
  bar.getBorder().setTransparent();

  textBox_(slide, p.title, 40, 32, SLIDE_W - 80, 44, 24, true, '#212529');
  textBox_(slide, p.headline, 40, 76, SLIDE_W - 80, 24, 13, false, '#495057');
  textBox_(slide, p.count, 40, 112, SLIDE_W - 80, 24, 15, true, '#1971c2');

  var itemFont = p.items.split('\n').length > 5 ? 13 : 15;
  textBox_(slide, p.items, 40, 142, SLIDE_W - 80, 210, itemFont, false, '#212529');

  textBox_(slide, p.footer, 40, SLIDE_H - 42, SLIDE_W - 80, 24, 11, false, '#868e96');
}

function textBox_(slide, text, left, top, width, height, size, bold, color) {
  var box = slide.insertTextBox(text || ' ', left, top, width, height);
  var style = box.getText().getTextStyle();
  style.setFontSize(size).setForegroundColor(color).setBold(!!bold);
  style.setFontFamily('Sarabun'); // ฟอนต์ไทยอ่านง่าย ถ้าไม่มีในบัญชี Google จะ fallback ให้เอง
  box.getText().getParagraphs().forEach(function (para) {
    para.getRange().getParagraphStyle().setLineSpacing(115).setSpaceBelow(4);
  });
  return box;
}
