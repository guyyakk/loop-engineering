// Smoke test: รัน validateMeeting_ / buildLineText_ / buildEmailHtml_ นอก Apps Script
// โดย stub บริการของ Google ที่โค้ดเรียกใช้ แล้วป้อนข้อมูลปลอมแทนการอ่านชีต
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const DIR = process.argv[2] || path.join(__dirname, '..');
const files = ['Config.gs', 'Data.gs', 'Render.gs'];

const props = {};
const sandbox = {
  console,
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  Logger: { log: (...a) => console.log('[Logger]', ...a) },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = v; }
    })
  },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      const p = (n) => String(n).padStart(2, '0');
      return fmt.replace('HH', p(d.getHours())).replace('mm', p(d.getMinutes()));
    }
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => { throw new Error('ไม่ควรถูกเรียกในเทสต์นี้'); },
    getUi: () => { throw new Error('ไม่ควรถูกเรียกในเทสต์นี้'); }
  }
};
vm.createContext(sandbox);
files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sandbox, { filename: f }));

// ---- ข้อมูลทดสอบ ----
const people = {
  'สมชาย': { name: 'สมชาย', email: 'somchai@example.com', active: true },
  'สุดา': { name: 'สุดา', email: 'suda@example.com', active: true }
};
vm.runInContext('peopleMap_ = () => (' + JSON.stringify(people) + ');', sandbox);

const meeting = {
  _row: 2, meeting_id: 'MOM-2026-001', title: 'Weekly Production Review',
  date: new Date(2026, 8, 7), start_time: new Date(2026, 8, 7, 10, 0), end_time: new Date(2026, 8, 7, 11, 0),
  location: 'ห้อง A', chair: 'สมชาย', note_taker: 'สุดา',
  attendees: 'สมชาย, สุดา, แขกรับเชิญ', absentees: '',
  decisions: 'อนุมัติสั่งซื้อคอลัมน์ HPLC ล็อตใหม่\nเลื่อนการตรวจสอบซัพพลายเออร์ไปเดือนหน้า',
  open_issues: 'ยังไม่มีข้อสรุปเรื่องงบซ่อมเครื่อง',
  next_meeting_at: new Date(2026, 8, 14, 10, 0), status: 'draft'
};

const good = [
  { _row: 2, meeting_id: 'MOM-2026-001', task: 'ส่งใบเสนอราคาเครื่อง HPLC ให้ฝ่ายจัดซื้อ', owner: 'สมชาย', due_date: new Date(2026, 8, 10), priority: 'High', status: 'Open' },
  { _row: 3, meeting_id: 'MOM-2026-001', task: 'สรุปผล OOS ของ batch 2609 พร้อมแนบ chromatogram', owner: 'สุดา', due_date: new Date(2026, 8, 12), priority: 'Medium', status: 'In progress' },
  { _row: 4, meeting_id: 'MOM-2026-001', task: 'ทบทวน SOP การสอบเทียบเครื่องชั่งประจำปี', owner: 'สมชาย', due_date: new Date(2026, 8, 9), priority: 'Low', status: 'Open' }
];

const bad = [
  { _row: 5, meeting_id: 'MOM-2026-001', task: 'ตามที่คุย', owner: '', due_date: '', priority: '', status: 'กำลังทำ' },
  { _row: 6, meeting_id: 'MOM-2026-001', task: 'ทำรายงานสรุปยอดผลิตประจำเดือน', owner: 'สมชาย และ สุดา', due_date: new Date(2026, 8, 1), priority: 'High', status: 'Open' },
  { _row: 7, meeting_id: 'MOM-2026-001', task: 'ประสานงานกับผู้รับเหมาเรื่องระบบน้ำ', owner: 'คนนอกทะเบียน', due_date: new Date(2026, 8, 20), priority: 'High', status: 'Open' }
];

function run(label, items) {
  const v = sandbox.validateMeeting_(meeting, items);
  console.log('\n===== ' + label + ' =====');
  console.log('errors  (' + v.errors.length + '):');
  v.errors.forEach((e) => console.log('  ❌ ' + e));
  console.log('warnings(' + v.warnings.length + '):');
  v.warnings.forEach((w) => console.log('  ⚠ ' + w));
  return v;
}

const okRes = run('ข้อมูลถูกต้อง', good);
const badRes = run('ข้อมูลผิด 3 แถว', bad);

console.log('\n===== ลำดับการเรียง (ควรเป็น 9, 10, 12 ก.ย.) =====');
sandbox.sortItems_(good).forEach((it) => console.log('  ' + sandbox.fmtDate_(it.due_date) + '  ' + it.owner + ' — ' + it.task));

console.log('\n===== ข้อความ LINE (MAX_ITEMS_IN_IMAGE = 2) =====');
props.MAX_ITEMS_IN_IMAGE = '2';
console.log(sandbox.buildLineText_(meeting, good));

props.MAX_ITEMS_IN_IMAGE = '5';
console.log('\n===== หัวข้ออีเมล =====');
console.log(sandbox.subjectOf_(meeting, good));

const html = sandbox.buildEmailHtml_(meeting, good);
console.log('\n===== อีเมล HTML =====');
console.log('ความยาว ' + html.length + ' ตัวอักษร');
console.log('มีตาราง: ' + /<table/.test(html) + ' | มีมติ 2 ข้อ: ' + ((html.match(/<li /g) || []).length));
console.log('escape ทำงาน: ' + sandbox.esc_('<script>&"x"'));

console.log('\n===== ปี พ.ศ. =====');
props.USE_BUDDHIST_YEAR = 'true';
console.log('  ' + sandbox.fmtDate_(meeting.date) + ' / ' + sandbox.fmtDateTime_(meeting.next_meeting_at));
props.USE_BUDDHIST_YEAR = 'false';

// ---- สรุปผลแบบ assert ----
const checks = [
  ['ข้อมูลถูกต้องต้องไม่มี error', okRes.errors.length === 0],
  ['แขกรับเชิญที่ไม่มีในทะเบียนต้องเป็น warning', okRes.warnings.length === 1],
  ['task สั้น + ไม่มี owner + ไม่มี due + owner หลายคน + due ย้อนหลัง = 5 errors', badRes.errors.length === 5],
  ['ดัก owner หลายคนที่คั่นด้วยคำว่า "และ" ได้', badRes.errors.some((e) => e.indexOf('มีหลายคน') > -1)],
  ['แขก + สถานะไม่รู้จัก + owner นอกทะเบียน = 3 warnings', badRes.warnings.length === 3],
  ['เวลาแสดงเป็น HH:mm ไม่ใช่วันที่เต็ม', /· 10:00–11:00 ·/.test(sandbox.meetingHeadline_(meeting))],
  ['เรียงตามกำหนดเสร็จ', sandbox.sortItems_(good)[0].due_date.getDate() === 9],
  ['หัวข้ออีเมลมีจำนวนงาน', sandbox.subjectOf_(meeting, good).indexOf('(3 action items)') > -1],
  ['อีเมลมีตาราง', /<table/.test(html)]
];
console.log('\n===== ผลรวม =====');
let fail = 0;
checks.forEach(([name, pass]) => { if (!pass) fail++; console.log((pass ? '  PASS  ' : '  FAIL  ') + name); });
console.log(fail === 0 ? '\nผ่านทั้งหมด ' + checks.length + ' ข้อ' : '\nไม่ผ่าน ' + fail + ' ข้อ');
process.exit(fail === 0 ? 0 : 1);
