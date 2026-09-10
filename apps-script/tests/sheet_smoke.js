/**
 * เทสต์ชั้นที่คุยกับชีตจริง ๆ (upsertMeeting_, replaceItems_, formSaveCore_, webStartNew)
 *
 * ทำไมต้องมี: บั๊กที่เจอจากการใช้งานจริงทุกตัวอยู่ชั้นนี้ทั้งหมด —
 * ประชุมซ้ำเมื่อฟอร์มส่ง meeting_id ว่าง, image_url หายตอนบันทึกทับ,
 * แถวงานเปล่าถูกบันทึก, และการล้างทั้งชีตทุกครั้งที่กดบันทึก
 * smoke.js ครอบคลุมแค่ฟังก์ชันบริสุทธิ์ จึงจับอะไรพวกนี้ไม่ได้เลย
 *
 * วิธีใช้:  node tests/sheet_smoke.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { FakeSpreadsheet, seedSheet, dumpSheet } = require('./fake_sheets');

const DIR = process.argv[2] || path.join(__dirname, '..');
const FILES = ['Config.gs', 'Setup.gs', 'Data.gs', 'Render.gs', 'Form.gs', 'Image.gs', 'WebApp.gs'];

const MEET_HEADERS = ['meeting_id', 'title', 'date', 'start_time', 'end_time', 'location',
  'chair', 'note_taker', 'attendees', 'absentees', 'decisions', 'open_issues',
  'next_meeting_at', 'status', 'sent_at', 'image_url', 'agenda', 'updated_at'];
const ITEM_HEADERS = ['item_id', 'meeting_id', 'task', 'owner', 'due_date', 'priority', 'status', 'note'];

let lockHeld = false;
const lockLog = [];

function makeSandbox(ss) {
  const props = {};
  const sandbox = {
    console,
    Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
    Logger: { log: () => {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = v; }
      })
    },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        const p = (n) => String(n).padStart(2, '0');
        return fmt
          .replace(/'([^']*)'/g, (m, g) => ' ' + g + ' ')
          .replace(/yyyy/g, d.getFullYear()).replace(/MM/g, p(d.getMonth() + 1))
          .replace(/dd/g, p(d.getDate())).replace(/HH/g, p(d.getHours()))
          .replace(/mm/g, p(d.getMinutes())).replace(/ss/g, p(d.getSeconds()))
          .replace(/ /g, '');
      },
      base64Encode: () => 'ZmFrZQ=='
    },
    LockService: {
      getDocumentLock: () => ({
        tryLock: () => {
          // ล็อกนี้ไม่ reentrant เหมือนของจริง ถ้าโค้ดขอซ้ำซ้อนกันจะจับได้ตรงนี้
          if (lockHeld) { lockLog.push('ขอล็อกซ้อน'); return false; }
          lockHeld = true;
          lockLog.push('lock');
          return true;
        },
        waitLock: () => { if (lockHeld) throw new Error('ขอล็อกซ้อน'); lockHeld = true; },
        releaseLock: () => { lockHeld = false; lockLog.push('unlock'); }
      })
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      getUi: () => { throw new Error('ห้ามเรียก getUi ในเส้นทางของ Web App'); },
      newDataValidation: () => {
        const b = {
          requireValueInRange: () => b, requireValueInList: () => b, requireDate: () => b,
          setAllowInvalid: () => b, setHelpText: () => b, build: () => ({})
        };
        return b;
      },
      newConditionalFormatRule: () => {
        const b = {
          whenFormulaSatisfied: () => b, setBackground: () => b, setFontColor: () => b,
          setRanges: () => b, build: () => ({})
        };
        return b;
      }
    }
  };
  vm.createContext(sandbox);
  FILES.forEach((f) => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sandbox, { filename: f }));
  return sandbox;
}

function freshSheet(extraMeetings, extraItems) {
  const ss = new FakeSpreadsheet();
  seedSheet(ss, 'meetings', [MEET_HEADERS].concat(extraMeetings || []));
  seedSheet(ss, 'action_items', [ITEM_HEADERS].concat(extraItems || []));
  seedSheet(ss, 'people', [
    ['name', 'email', 'department', 'active'],
    ['สมชาย', 'somchai@example.com', 'QC', 'yes'],
    ['สุดา', 'suda@example.com', 'QA', 'yes']
  ]);
  return ss;
}

function meetingRow(id, title, status, imageUrl) {
  const row = new Array(MEET_HEADERS.length).fill('');
  row[0] = id;
  row[1] = title;
  row[2] = new Date(2026, 8, 7);
  row[13] = status || 'draft';
  row[15] = imageUrl || '';
  return row;
}

function itemRow(itemId, meetingId, task, owner, status, note) {
  return [itemId, meetingId, task, owner, new Date(2026, 8, 10), 'Medium', status || 'Open', note || ''];
}

const checks = [];
function check(name, pass, detail) {
  checks.push([name, pass, detail]);
}

/** ห่อทุกชุดทดสอบไว้ เพื่อให้ชุดที่พังไม่บังผลของชุดอื่น */
function suite(name, fn) {
  try {
    fn();
  } catch (e) {
    lockHeld = false; // กันล็อกค้างไปถึงชุดถัดไป
    check(name + ' (ชุดนี้โยน error)', false, String(e.message || e));
  }
}

/* ---------------------------------------------------- 1. upsertMeeting_ */

suite('testCreateFirstMeeting', function () {
  const ss = freshSheet();
  const sb = makeSandbox(ss);
  const res = sb.upsertMeeting_({ meeting_id: '', title: 'ประชุมแรก', date: '2026-09-10', attendees: ['สมชาย'] });
  const rows = dumpSheet(ss, 'meetings');
  check('ยังไม่มีประชุมเลย -> สร้างแถวใหม่พร้อมรหัส',
    rows.length === 2 && res.id === 'MOM-2026-001' && rows[1][1] === 'ประชุมแรก', res.id);
});

suite('testUpdateKeepsSystemFields', function () {
  const ss = freshSheet([meetingRow('MOM-2026-001', 'เดิม', 'sent', 'https://drive/x.png')]);
  const sh = ss.getSheetByName('meetings');
  sh.write(2, 15, new Date(2026, 8, 8, 9, 0)); // sent_at
  sh.write(2, 10, 'คนที่ลา');                    // absentees
  const sb = makeSandbox(ss);
  sb.upsertMeeting_({ meeting_id: 'MOM-2026-001', title: 'แก้ชื่อแล้ว', date: '2026-09-10' });
  const rows = dumpSheet(ss, 'meetings');
  check('บันทึกทับแล้วค่าที่ระบบดูแลเองต้องไม่หาย (status/sent_at/image_url/absentees)',
    rows.length === 2 && rows[1][1] === 'แก้ชื่อแล้ว' && rows[1][13] === 'sent' &&
    rows[1][15] === 'https://drive/x.png' && rows[1][9] === 'คนที่ลา' && rows[1][14] !== '',
    JSON.stringify([rows[1][13], rows[1][15], rows[1][9]]));
});

suite('testEmptyIdDoesNotDuplicate', function () {
  const ss = freshSheet([meetingRow('MOM-2026-001', 'ร่างที่ค้างอยู่', 'draft')]);
  const sb = makeSandbox(ss);
  const res = sb.upsertMeeting_({ meeting_id: '', title: 'พิมพ์ต่อหลังรีเฟรช', date: '2026-09-10' });
  const rows = dumpSheet(ss, 'meetings');
  check('ฟอร์มส่งรหัสว่างมา (รีเฟรชหน้า) -> เขียนทับร่างเดิม ไม่สร้างประชุมซ้ำ',
    rows.length === 2 && res.id === 'MOM-2026-001' && rows[1][1] === 'พิมพ์ต่อหลังรีเฟรช',
    'จำนวนแถว ' + (rows.length - 1));
});

/* ---------------------------------------------------- 2. replaceItems_ */

suite('testReplaceOnlyTouchesOwnMeeting', function () {
  const ss = freshSheet(
    [meetingRow('MOM-2026-001', 'ประชุม 1', 'draft'), meetingRow('MOM-2026-002', 'ประชุม 2', 'draft')],
    [
      itemRow('MOM-2026-001-A1', 'MOM-2026-001', 'งานเก่า 1', 'สมชาย'),
      itemRow('MOM-2026-002-A1', 'MOM-2026-002', 'งานของประชุมอื่น 1', 'สุดา', 'Done', 'หมายเหตุเดิม'),
      itemRow('MOM-2026-001-A2', 'MOM-2026-001', 'งานเก่า 2', 'สุดา'),
      itemRow('MOM-2026-002-A2', 'MOM-2026-002', 'งานของประชุมอื่น 2', 'สมชาย', 'Blocked', '')
    ]
  );
  const before = dumpSheet(ss, 'action_items').filter((r) => r[1] === 'MOM-2026-002');
  const sb = makeSandbox(ss);
  const sh = ss.getSheetByName('action_items');
  const lastRowBefore = sh.getLastRow();
  sh.writes.length = 0;
  sb.replaceItems_('MOM-2026-001', [{ task: 'งานใหม่', owner: 'สมชาย', due_date: '2026-09-12', priority: 'High' }]);
  const touchedExisting = sh.writes.filter((r) => r <= lastRowBefore);

  const after = dumpSheet(ss, 'action_items');
  const others = after.filter((r) => r[1] === 'MOM-2026-002');
  const mine = after.filter((r) => r[1] === 'MOM-2026-001');
  const untouched = JSON.stringify(others.map((r) => r.map(String))) ===
                    JSON.stringify(before.map((r) => r.map(String)));
  check('เขียนงานใหม่แล้วค่าของประชุมอื่นต้องเหมือนเดิม',
    untouched && others.length === 2 && mine.length === 1 && mine[0][2] === 'งานใหม่',
    'ประชุมอื่นเหลือ ' + others.length + ' แถว, ของเรา ' + mine.length + ' แถว');
  // ข้อนี้คือหัวใจของการแก้: โค้ดเดิมล้างและเขียนทั้งชีตใหม่ทุกครั้ง
  // การเทียบแค่ "ค่าเหมือนเดิม" จับไม่ได้ เพราะโค้ดเดิมก็เขียนค่าเดิมกลับไป
  // จึงต้องดูว่ามีการแตะเซลล์ของแถวที่มีอยู่เดิมหรือไม่
  check('ต้องไม่เขียนทับแถวที่มีอยู่เดิมเลย (เขียนต่อท้ายแล้วค่อยลบของเก่า)',
    touchedExisting.length === 0, 'เขียนทับแถวเดิม ' + touchedExisting.length + ' ครั้ง');
});

suite('testReplaceKeepsStatusAndNote', function () {
  const ss = freshSheet(
    [meetingRow('MOM-2026-001', 'ประชุม 1', 'draft')],
    [itemRow('MOM-2026-001-A1', 'MOM-2026-001', 'งานเดิม', 'สมชาย', 'In progress', 'รอของ')]
  );
  const sb = makeSandbox(ss);
  // ฟอร์มไม่ได้ส่ง note มา (undefined) จึงต้องใช้ของเดิมในชีต
  sb.replaceItems_('MOM-2026-001', [{ task: 'งานเดิม', owner: 'สมชาย', due_date: '2026-09-12' }]);
  const row = dumpSheet(ss, 'action_items').filter((r) => r[1] === 'MOM-2026-001')[0];
  check('งานเดิมชื่อเดิมคนเดิม -> สถานะและหมายเหตุที่อัปเดตในชีตต้องไม่ถูกล้าง',
    row[6] === 'In progress' && row[7] === 'รอของ', JSON.stringify([row[6], row[7]]));
});

suite('testReplaceWithNoItems', function () {
  const ss = freshSheet(
    [meetingRow('MOM-2026-001', 'ประชุม 1', 'draft')],
    [
      itemRow('MOM-2026-001-A1', 'MOM-2026-001', 'งานเก่า', 'สมชาย'),
      itemRow('MOM-2026-002-A1', 'MOM-2026-002', 'ของประชุมอื่น', 'สุดา')
    ]
  );
  const sb = makeSandbox(ss);
  sb.replaceItems_('MOM-2026-001', []);
  const after = dumpSheet(ss, 'action_items');
  check('ลบงานออกหมด -> เหลือเฉพาะแถวของประชุมอื่น',
    after.length === 2 && after[1][1] === 'MOM-2026-002', 'เหลือ ' + (after.length - 1) + ' แถว');
});

suite('testDeleteRowsDesc', function () {
  const ss = freshSheet([], [
    itemRow('a', 'M1', 'a', 'x'), itemRow('b', 'M2', 'b', 'x'), itemRow('c', 'M1', 'c', 'x'),
    itemRow('d', 'M1', 'd', 'x'), itemRow('e', 'M2', 'e', 'x')
  ]);
  const sb = makeSandbox(ss);
  const sh = ss.getSheetByName('action_items');
  sb.deleteRowsDesc_(sh, [2, 4, 5]); // แถวไม่ติดกัน + ติดกัน ปนกัน
  const left = dumpSheet(ss, 'action_items').slice(1).map((r) => r[0]);
  check('ลบหลายแถวที่ไม่ติดกันแล้วแถวที่เหลือต้องถูกต้อง',
    JSON.stringify(left) === JSON.stringify(['b', 'e']), JSON.stringify(left));
});

/* ---------------------------------------------------- 3. เส้นทางเต็มของการบันทึก */

suite('testFormSaveEndToEnd', function () {
  const ss = freshSheet();
  const sb = makeSandbox(ss);
  const res = sb.formSave({
    meeting_id: '', title: 'ประชุมทดสอบ', date: '2026-09-10', note_taker: 'สุดา',
    attendees: ['สมชาย', 'สุดา'], agenda: 'วาระที่หนึ่ง', decisions: 'มติหนึ่ง',
    items: [
      { task: 'งาน A', owner: 'สมชาย', due_date: '2026-09-12', priority: 'High', note: 'ต้องใช้ข้อมูลจาก QC' },
      { task: 'งาน B', owner: 'สุดา', due_date: '2026-09-15', priority: 'Low', note: '' }
    ]
  }, true);
  const items = sb.getItems_(res.meeting_id);
  const meetingRowOut = dumpSheet(ss, 'meetings')[1];
  check('บันทึกครบวงจร: ได้แถวประชุม + งาน 2 แถว + วาระ + หมายเหตุ',
    res.errors.length === 0 && items.length === 2 &&
    meetingRowOut[16] === 'วาระที่หนึ่ง' && items[0].note === 'ต้องใช้ข้อมูลจาก QC',
    'errors=' + JSON.stringify(res.errors));
  check('formSave ปล่อยล็อกหลังทำงานเสร็จ', lockHeld === false, 'lockHeld=' + lockHeld);
});

suite('testStartNewThenSaveTargetsNewMeeting', function () {
  const ss = freshSheet([meetingRow('MOM-2026-001', 'ประชุมเก่า', 'draft', 'https://drive/old.png')]);
  const sb = makeSandbox(ss);
  const fresh = sb.webStartNew();
  // ฟอร์มหลังกดเริ่มใหม่จะส่งรหัสของประชุมใหม่กลับมา
  sb.formSave({ meeting_id: fresh.meeting.meeting_id, title: 'ประชุมใหม่', date: '2026-09-11', items: [] }, false);
  const rows = dumpSheet(ss, 'meetings');
  check('เริ่มประชุมใหม่แล้วบันทึก -> ประชุมเก่ายังอยู่ครบ ไม่ถูกทับ',
    rows.length === 3 && rows[1][1] === 'ประชุมเก่า' && rows[1][15] === 'https://drive/old.png' &&
    rows[2][0] === 'MOM-2026-002' && rows[2][1] === 'ประชุมใหม่',
    JSON.stringify(rows.slice(1).map((r) => r[0] + ':' + r[1])));
});

/* ---------------------------------------------------- 4. อัปเกรดคอลัมน์ของชีตเก่า */

suite('testHeaderMigration', function () {
  const ss = new FakeSpreadsheet();
  const oldHeaders = MEET_HEADERS.slice(0, 16); // ชีตเวอร์ชันก่อนมี agenda
  seedSheet(ss, 'meetings', [oldHeaders, meetingRow('MOM-2026-001', 'ของเดิม', 'draft').slice(0, 16)]);
  seedSheet(ss, 'action_items', [ITEM_HEADERS]);
  seedSheet(ss, 'people', [['name', 'email', 'department', 'active']]);
  const sb = makeSandbox(ss);

  // setupSheets เรียก ui_() ตอนท้าย จึงเรียกเฉพาะส่วนที่ทดสอบได้
  const sh = ss.getSheetByName('meetings');
  const current = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].filter((h) => h !== '');
  const expected = sb.HEADERS['meetings'];
  const isOlder = current.length < expected.length &&
    expected.slice(0, current.length).join('|') === current.join('|');
  if (isOlder) {
    sh.getRange(1, current.length + 1, 1, expected.length - current.length)
      .setValues([expected.slice(current.length)]);
  }
  const after = dumpSheet(ss, 'meetings');
  check('ชีตเวอร์ชันเก่า -> เติมคอลัมน์ที่ขาดต่อท้าย ข้อมูลเดิมไม่ขยับ',
    isOlder && after[0][16] === 'agenda' && after[1][1] === 'ของเดิม',
    'หัวตารางสุดท้าย = ' + after[0][16]);
});

/* ---------------------------------------------------- 5. เพิ่มคนใหม่จากหน้าฟอร์ม */

suite('testAddNewPerson', function () {
  const ss = freshSheet();
  const sb = makeSandbox(ss);
  const res = sb.webAddPerson({ name: 'วิภา', department: 'Production', email: 'wipa@example.com' });
  const rows = dumpSheet(ss, 'people');
  check('เพิ่มคนใหม่ -> ได้แถวในชีต people และอยู่ในรายชื่อที่ส่งกลับ',
    res.status === 'added' && rows.length === 4 &&
    rows[3][0] === 'วิภา' && rows[3][3] === 'yes' &&
    res.people.some((p) => p.name === 'วิภา' && p.department === 'Production'),
    JSON.stringify(rows[3]));
});

suite('testAddPersonWithoutEmail', function () {
  const ss = freshSheet();
  const sb = makeSandbox(ss);
  const res = sb.webAddPerson({ name: 'แขกรับเชิญ' });
  check('เพิ่มได้แม้ไม่ใส่อีเมล และบอกกลับว่ายังไม่มีอีเมล',
    res.status === 'added' && res.has_email === false, JSON.stringify(res.status));
});

suite('testAddDuplicatePerson', function () {
  const ss = freshSheet();
  const sb = makeSandbox(ss);
  const res = sb.webAddPerson({ name: '  สมชาย  ', email: 'other@example.com' });
  const rows = dumpSheet(ss, 'people');
  check('ชื่อซ้ำ -> ไม่สร้างแถวใหม่ และไม่ทับอีเมลเดิม',
    res.status === 'exists' && rows.length === 3 && rows[1][1] === 'somchai@example.com',
    'จำนวนแถว ' + (rows.length - 1) + ' อีเมล ' + rows[1][1]);
});

suite('testReactivatePerson', function () {
  const ss = freshSheet();
  const sh = ss.getSheetByName('people');
  sh.write(2, 4, 'no'); // ปิดใช้งานสมชายไว้
  const sb = makeSandbox(ss);
  const res = sb.webAddPerson({ name: 'สมชาย' });
  check('คนที่เคยปิดใช้งาน -> เปิดกลับให้แทนการสร้างซ้ำ',
    res.status === 'reactivated' && dumpSheet(ss, 'people')[1][3] === 'yes', res.status);
});

suite('testAddPersonValidation', function () {
  const ss = freshSheet();
  const sb = makeSandbox(ss);
  let blank = null, multi = null, badEmail = null;
  try { sb.webAddPerson({ name: '   ' }); } catch (e) { blank = e.message; }
  try { sb.webAddPerson({ name: 'สมหญิง และ สมศรี' }); } catch (e) { multi = e.message; }
  try { sb.webAddPerson({ name: 'ทดสอบ', email: 'ไม่ใช่อีเมล' }); } catch (e) { badEmail = e.message; }
  check('กันชื่อว่าง / ใส่หลายคนในครั้งเดียว / อีเมลผิดรูปแบบ',
    !!blank && !!multi && !!badEmail && dumpSheet(ss, 'people').length === 3,
    JSON.stringify([blank, multi, badEmail]));
});

/* ---------------------------------------------------- 6. เขียนอิงชื่อคอลัมน์ ไม่ใช่ตำแหน่ง */

suite('testWritesFollowSheetColumnOrder', function () {
  // จำลองว่ามีคนลากสลับคอลัมน์ในชีต: เอา status กับ title ไปไว้หน้าสุด
  const shuffled = ['status', 'title'].concat(
    MEET_HEADERS.filter((h) => h !== 'status' && h !== 'title'));
  const ss = new FakeSpreadsheet();
  seedSheet(ss, 'meetings', [shuffled]);
  seedSheet(ss, 'action_items', [ITEM_HEADERS]);
  seedSheet(ss, 'people', [['name', 'email', 'department', 'active']]);
  const sb = makeSandbox(ss);

  sb.upsertMeeting_({ meeting_id: '', title: 'ชื่อประชุมต้องลงช่องชื่อ', date: '2026-09-10' });

  const rows = dumpSheet(ss, 'meetings');
  const idx = {};
  rows[0].forEach((h, i) => { idx[h] = i; });
  check('สลับคอลัมน์ในชีตแล้ว การเขียนต้องยังลงถูกช่อง',
    rows[1][idx.title] === 'ชื่อประชุมต้องลงช่องชื่อ' &&
    rows[1][idx.status] === 'draft' &&
    String(rows[1][idx.meeting_id]).indexOf('MOM-') === 0,
    JSON.stringify([rows[1][idx.title], rows[1][idx.status], rows[1][idx.meeting_id]]));
});

suite('testTrailingColumnAutoAdded', function () {
  // ชีตเวอร์ชันเก่าที่ยังไม่มี updated_at — ผู้ใช้ที่ใช้เฉพาะ Web App สั่งเมนูในชีตไม่ได้
  // ระบบจึงต้องเติมคอลัมน์ท้ายตารางให้เองแทนที่จะปฏิเสธจนใช้งานไม่ได้
  const ss = new FakeSpreadsheet();
  const oldHeaders = MEET_HEADERS.slice(0, MEET_HEADERS.length - 1);
  seedSheet(ss, 'meetings', [oldHeaders, meetingRow('MOM-2026-001', 'ของเดิม', 'draft').slice(0, oldHeaders.length)]);
  seedSheet(ss, 'action_items', [ITEM_HEADERS]);
  seedSheet(ss, 'people', [['name', 'email', 'department', 'active']]);
  const sb = makeSandbox(ss);

  sb.upsertMeeting_({ meeting_id: 'MOM-2026-001', title: 'บันทึกได้เลย', date: '2026-09-10' });
  const rows = dumpSheet(ss, 'meetings');
  check('ชีตเก่าที่ขาดคอลัมน์ท้ายตาราง -> เติมให้เองแล้วบันทึกต่อได้',
    rows[0][rows[0].length - 1] === 'updated_at' && rows[1][1] === 'บันทึกได้เลย',
    JSON.stringify(rows[0].slice(-2)));
});

suite('testMissingColumnIsRefused', function () {
  const ss = new FakeSpreadsheet();
  seedSheet(ss, 'meetings', [MEET_HEADERS.filter((h) => h !== 'status')]); // ขาดคอลัมน์สำคัญ
  seedSheet(ss, 'action_items', [ITEM_HEADERS]);
  seedSheet(ss, 'people', [['name', 'email', 'department', 'active']]);
  const sb = makeSandbox(ss);
  let msg = null;
  try {
    sb.upsertMeeting_({ meeting_id: '', title: 'x', date: '2026-09-10' });
  } catch (e) { msg = e.message; }
  check('ชีตขาดคอลัมน์ที่ระบบต้องใช้ -> ปฏิเสธพร้อมบอกชื่อคอลัมน์ ไม่เขียนมั่ว',
    !!msg && msg.indexOf('status') > -1 && dumpSheet(ss, 'meetings').length === 1, msg);
});

/* ---------------------------------------------------- 7. กันสองแท็บเขียนทับกัน */

suite('testConcurrentOverwriteIsBlocked', function () {
  const ss = freshSheet([meetingRow('MOM-2026-001', 'ร่าง', 'draft')]);
  const sb = makeSandbox(ss);

  // แท็บ A และ B เปิดฟอร์มพร้อมกัน ได้ updated_at ชุดเดียวกัน
  sb.upsertMeeting_({ meeting_id: 'MOM-2026-001', title: 'ตั้งต้น', date: '2026-09-10' });
  const loaded = sb.formInit().meeting.updated_at;

  // แท็บ A บันทึกก่อน
  sb.upsertMeeting_({ meeting_id: 'MOM-2026-001', title: 'A บันทึกแล้ว', date: '2026-09-10',
                      updated_at: loaded });

  // แท็บ B ถือ updated_at เก่ามาบันทึกทับ
  let conflict = null;
  try {
    sb.upsertMeeting_({ meeting_id: 'MOM-2026-001', title: 'B ทับ', date: '2026-09-10',
                        updated_at: loaded });
  } catch (e) { conflict = e.message; }

  const title = dumpSheet(ss, 'meetings')[1][1];
  check('แท็บที่ถือข้อมูลเก่ามาบันทึกทับ -> ถูกปฏิเสธ และของเดิมไม่ถูกแตะ',
    !!conflict && conflict.indexOf('CONFLICT') === 0 && title === 'A บันทึกแล้ว',
    JSON.stringify([conflict, title]));
});

suite('testForceOverwriteWhenUserChooses', function () {
  const ss = freshSheet([meetingRow('MOM-2026-001', 'ร่าง', 'draft')]);
  const sb = makeSandbox(ss);
  sb.upsertMeeting_({ meeting_id: 'MOM-2026-001', title: 'ตั้งต้น', date: '2026-09-10' });
  const stale = sb.formInit().meeting.updated_at;
  sb.upsertMeeting_({ meeting_id: 'MOM-2026-001', title: 'คนอื่นบันทึก', date: '2026-09-10', updated_at: stale });

  sb.upsertMeeting_({ meeting_id: 'MOM-2026-001', title: 'ยืนยันทับ', date: '2026-09-10',
                      updated_at: stale, force: true });
  check('ถ้าผู้ใช้ยืนยันว่าจะทับ (force) ต้องบันทึกได้',
    dumpSheet(ss, 'meetings')[1][1] === 'ยืนยันทับ', dumpSheet(ss, 'meetings')[1][1]);
});

suite('testNoStampMeansNoCheck', function () {
  const ss = freshSheet([meetingRow('MOM-2026-001', 'ร่าง', 'draft')]);
  const sb = makeSandbox(ss);
  sb.upsertMeeting_({ meeting_id: 'MOM-2026-001', title: 'บันทึกครั้งแรก', date: '2026-09-10' });
  // ฟอร์มเวอร์ชันเก่าที่ไม่ได้ส่ง updated_at มาเลย ต้องยังบันทึกได้ (ไม่ทำให้ของเดิมพัง)
  sb.upsertMeeting_({ meeting_id: 'MOM-2026-001', title: 'ฟอร์มเก่า', date: '2026-09-10' });
  check('ฟอร์มที่ไม่ได้ส่ง updated_at มา ยังบันทึกได้ตามปกติ',
    dumpSheet(ss, 'meetings')[1][1] === 'ฟอร์มเก่า', dumpSheet(ss, 'meetings')[1][1]);
});

/* ---------------------------------------------------- สรุปผล */

console.log('\n===== เทสต์ชั้นที่คุยกับชีต =====');
let fail = 0;
checks.forEach(([name, pass, detail]) => {
  if (!pass) fail++;
  console.log((pass ? '  PASS  ' : '  FAIL  ') + name + (pass ? '' : '   [' + detail + ']'));
});
console.log(fail === 0 ? '\nผ่านทั้งหมด ' + checks.length + ' ข้อ' : '\nไม่ผ่าน ' + fail + ' ข้อ');
process.exit(fail === 0 ? 0 : 1);
