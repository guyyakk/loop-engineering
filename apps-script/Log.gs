/**
 * Log.gs — บันทึก error ที่เกิดกับผู้ใช้จริง และคุมว่าใครเรียกฟังก์ชันของ Web App ได้
 *
 * ทำไมต้องเขียน log ลงชีต: Logger.log ดูได้เฉพาะใน Executions ของเจ้าของสคริปต์
 * และหายไปตามเวลา ถ้าผู้ใช้เจอ error ตอนที่คนดูแลไม่อยู่ จะไม่เหลือร่องรอยให้ไล่เลย
 * ชีต log จึงเป็นบันทึกถาวรที่เปิดดูย้อนหลังได้ทันที
 */

var LOG_SHEET = 'log';
var LOG_HEADERS = ['at', 'user', 'function', 'message'];
var LOG_KEEP = 500;   // จำนวนบรรทัดที่เก็บไว้
var LOG_TRIM_AT = 700; // เกินเท่านี้เมื่อไหร่ค่อยตัด จะได้ไม่ต้องตัดทุกครั้ง

/** ครอบฟังก์ชันที่หน้าเว็บเรียก เพื่อให้ error ทุกตัวถูกบันทึกก่อนโยนกลับไปแสดงผล */
function guarded_(fnName, fn) {
  try {
    return fn();
  } catch (e) {
    logError_(fnName, e);
    throw e;
  }
}

function logError_(fnName, e) {
  // การบันทึก log ต้องไม่ทำให้ปัญหาเดิมแย่ลง ถ้าเขียนไม่ได้ก็ปล่อยผ่าน
  try {
    var sh = ss_().getSheetByName(LOG_SHEET);
    if (!sh) {
      sh = ss_().insertSheet(LOG_SHEET);
      sh.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
      sh.setFrozenRows(1);
    }
    var msg = String((e && e.message) || e);
    if (e && e.stack) msg += ' | ' + String(e.stack).split('\n').slice(0, 3).join(' / ');
    sh.appendRow([new Date(), currentUserEmail_(), fnName, msg.slice(0, 900)]);

    var last = sh.getLastRow();
    if (last > LOG_TRIM_AT) sh.deleteRows(2, last - LOG_KEEP);
  } catch (ignored) {
    Logger.log('เขียน log ไม่สำเร็จ: %s', ignored.message);
  }
}

/** บันทึกข้อสังเกตที่ไม่ใช่ error ลงชีต log ใช้ตอนต้องรู้ว่าเกิดอะไรขึ้นจริงบนเครื่องผู้ใช้ */
function logInfo_(fnName, message) {
  try {
    var sh = ss_().getSheetByName(LOG_SHEET);
    if (!sh) {
      sh = ss_().insertSheet(LOG_SHEET);
      sh.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
      sh.setFrozenRows(1);
    }
    sh.appendRow([new Date(), currentUserEmail_(), fnName, String(message).slice(0, 900)]);
  } catch (ignored) {
    Logger.log('เขียน log ไม่สำเร็จ: %s', ignored.message);
  }
}

function currentUserEmail_() {
  try {
    return String(Session.getActiveUser().getEmail() || '').trim();
  } catch (e) {
    return ''; // บางบริบทไม่ยอมบอกอีเมลผู้ใช้ ถือว่าไม่รู้
  }
}

/**
 * คุมว่าใครเรียกได้ — เตรียมไว้สำหรับวันที่เปลี่ยน webapp.access เป็น ANYONE
 *
 * ตอนนี้ access = MYSELF อยู่ ฟังก์ชันนี้จึงไม่มีผลกับการใช้งานปกติ
 * แต่ต้องมีไว้ก่อน เพราะวันที่เปิดให้ทีมใช้ ถ้าไม่มีด่านนี้ ใครมีลิงก์ก็เขียนข้อมูล
 * และสั่งส่งอีเมลจากบัญชีเจ้าของได้ทันที
 *
 * เกณฑ์: เจ้าของสคริปต์ผ่านเสมอ · คนที่มีอีเมลอยู่ในชีต people และยัง active ผ่าน
 * ถ้าระบุตัวตนไม่ได้ (บางบัญชีไม่ยอมบอกอีเมล) ให้ผ่าน เพราะการเข้าถึงถูกคุมที่ระดับ
 * deployment อีกชั้นแล้ว การบล็อกตรงนี้จะทำให้เจ้าของใช้งานไม่ได้เอง
 */
function assertAllowed_() {
  var user = currentUserEmail_().toLowerCase();
  if (!user) return;

  var owner = '';
  try {
    owner = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  } catch (e) { /* ไม่รู้ก็ข้ามไป */ }
  if (owner && user === owner) return;

  var map = peopleMap_();
  var allowed = Object.keys(map).some(function (n) {
    return map[n].active && String(map[n].email || '').trim().toLowerCase() === user;
  });
  if (!allowed) {
    throw new Error('บัญชี ' + user + ' ยังไม่มีสิทธิ์ใช้ฟอร์มนี้ — ' +
                    'ให้ผู้ดูแลเพิ่มอีเมลนี้ลงในชีต people ก่อน');
  }
}
