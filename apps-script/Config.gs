/**
 * Config.gs — ค่าคงที่และการตั้งค่าของระบบ MOM
 *
 * ค่าที่เปลี่ยนบ่อยหรือเป็นข้อมูลเฉพาะองค์กร เก็บใน Script Properties
 * (Apps Script editor → Project Settings → Script Properties)
 * ห้าม hardcode อีเมลจริงหรือ secret ลงในไฟล์นี้ เพราะไฟล์นี้ถูก commit ลง repo
 */

var SHEET = {
  MEETINGS: 'meetings',
  ITEMS: 'action_items',
  PEOPLE: 'people'
};

var STATUS = {
  DRAFT: 'draft',
  SENT: 'sent'
};

var ITEM_STATUS = ['Open', 'In progress', 'Blocked', 'Done'];
var PRIORITY = ['High', 'Medium', 'Low'];

/** ค่าเริ่มต้นของ Script Properties — ตั้งใจให้ปลอดภัยไว้ก่อน */
var DEFAULTS = {
  DRY_RUN: 'true',              // true = ไม่ส่งอีเมลจริง แค่ log และแสดงตัวอย่าง
  SEND_INDIVIDUAL: 'false',     // true = ส่งเมลแยกรายบุคคลเฉพาะงานของคนนั้นด้วย
  CC_EMAILS: '',                // อีเมลผู้รับสำเนา คั่นด้วย comma
  SENDER_NAME: 'MOM Bot',
  SLIDE_TEMPLATE_ID: '',        // ว่าง = วาดสไลด์เองแบบแนวนอน 16:9
  IMAGE_FOLDER_ID: '',          // ว่าง = สร้างโฟลเดอร์ "MOM images" ให้อัตโนมัติ
  MAX_ITEMS_IN_IMAGE: '5',      // งานสูงสุดที่แสดงในรูป ที่เหลือสรุปเป็น "และอีก N รายการ"
  USE_BUDDHIST_YEAR: 'false',   // true = แสดงปี พ.ศ.
  MIN_TASK_LENGTH: '0',         // 0 = ไม่จำกัดความยาวชื่องาน / ใส่ตัวเลข = เตือน (ไม่บล็อก) เมื่อสั้นกว่านั้น
  SUMMARY_LINK: '',             // ลิงก์สรุปฉบับเต็ม (เช่น ลิงก์ชีต) ใส่ท้ายข้อความ LINE
  SPREADSHEET_ID: ''            // บันทึกอัตโนมัติตอนตั้งค่าเริ่มต้น ใช้ตอนรันจาก Web App
};

function props_() {
  return PropertiesService.getScriptProperties();
}

/** อ่านค่า config หนึ่งตัว ถ้าไม่เคยตั้งจะคืนค่า default */
function cfg_(key) {
  var v = props_().getProperty(key);
  return (v === null || v === '') ? (DEFAULTS[key] || '') : v;
}

function cfgBool_(key) {
  return String(cfg_(key)).toLowerCase() === 'true';
}

function cfgInt_(key) {
  var n = parseInt(cfg_(key), 10);
  return isNaN(n) ? parseInt(DEFAULTS[key], 10) : n;
}

function tz_() {
  return Session.getScriptTimeZone() || 'Asia/Bangkok';
}

/** แสดงค่า config ปัจจุบันทั้งหมด ใช้ตรวจก่อนส่งจริง */
function showSettings() {
  var lines = Object.keys(DEFAULTS).map(function (k) {
    var set = props_().getProperty(k);
    var mark = (set === null || set === '') ? ' (ค่าเริ่มต้น)' : '';
    return k + ' = ' + (cfg_(k) || '(ว่าง)') + mark;
  });
  lines.push('');
  lines.push('Timezone = ' + tz_());
  lines.push('');
  lines.push(cfgBool_('DRY_RUN')
    ? '>> DRY_RUN เปิดอยู่: จะไม่มีอีเมลออกจริง'
    : '>> DRY_RUN ปิดอยู่: กดส่งแล้วอีเมลจะออกจริง');
  ui_().alert('ค่าตั้งค่าปัจจุบัน', lines.join('\n'), ui_().ButtonSet.OK);
}

/** สลับโหมด DRY_RUN จากเมนู เพื่อไม่ต้องเข้าไปแก้ Script Properties เอง */
function toggleDryRun() {
  var now = cfgBool_('DRY_RUN');
  var next = !now;
  var msg = next
    ? 'เปลี่ยนเป็นโหมดทดสอบ (DRY_RUN = true) จะไม่มีอีเมลออกจริง'
    : 'เปลี่ยนเป็นโหมดส่งจริง (DRY_RUN = false) อีเมลจะถูกส่งออกจริงเมื่อกดยืนยัน';
  var res = ui_().alert('ยืนยันการเปลี่ยนโหมด', msg + '\n\nยืนยันหรือไม่', ui_().ButtonSet.YES_NO);
  if (res !== ui_().Button.YES) return;
  props_().setProperty('DRY_RUN', String(next));
  ui_().alert('เปลี่ยนแล้ว: DRY_RUN = ' + next);
}
