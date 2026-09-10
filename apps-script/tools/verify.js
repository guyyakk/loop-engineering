/**
 * ตรวจทุกอย่างก่อน deploy ด้วยคำสั่งเดียว
 *
 *   node tools/verify.js
 *
 * ทำ 4 อย่าง: คอมไพล์ไฟล์ .gs ทุกไฟล์, คอมไพล์ JavaScript ที่อยู่ใน FormUi.html,
 * รันเทสต์ฟังก์ชันบริสุทธิ์ และรันเทสต์ชั้นที่คุยกับชีต
 *
 * มีไว้เพราะเดิมต้องรันทีละอย่างด้วยมือ ซึ่งลืมง่ายและเคยทำให้ deploy โค้ดที่ยังไม่ได้ตรวจ
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const results = [];

function step(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail: detail || '' });
  } catch (e) {
    results.push({ name, ok: false, detail: String((e && e.message) || e).split('\n')[0] });
  }
}

step('คอมไพล์ไฟล์ .gs', () => {
  const files = fs.readdirSync(ROOT).filter((f) => f.endsWith('.gs'));
  if (!files.length) throw new Error('ไม่พบไฟล์ .gs เลย');
  files.forEach((f) => {
    // สร้าง Script = คอมไพล์อย่างเดียว ไม่รัน จึงจับ syntax error ได้โดยไม่ต้องมี Google API
    new vm.Script(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
  });
  return files.length + ' ไฟล์';
});

step('คอมไพล์ JavaScript ใน FormUi.html', () => {
  const html = fs.readFileSync(path.join(ROOT, 'FormUi.html'), 'utf8');
  const blocks = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
  if (!blocks.length) throw new Error('ไม่พบบล็อก <script> ใน FormUi.html');
  blocks.forEach((b, i) => {
    const code = b.replace(/^<script>/, '').replace(/<\/script>$/, '');
    new vm.Script(code, { filename: 'FormUi.html#' + (i + 1) });
  });
  return blocks.length + ' บล็อก';
});

function runTest(file) {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'tests', file)], { encoding: 'utf8' });
  const last = out.trim().split('\n').pop().trim();
  return last;
}

step('เทสต์ฟังก์ชันบริสุทธิ์ (tests/smoke.js)', () => runTest('smoke.js'));
step('เทสต์ชั้นที่คุยกับชีต (tests/sheet_smoke.js)', () => runTest('sheet_smoke.js'));

console.log('');
let failed = 0;
results.forEach((r) => {
  if (!r.ok) failed++;
  console.log((r.ok ? '  ผ่าน  ' : '  ไม่ผ่าน  ') + r.name + (r.detail ? '  — ' + r.detail : ''));
});
console.log('');
if (failed) {
  console.log('มี ' + failed + ' ขั้นที่ไม่ผ่าน — อย่า deploy จนกว่าจะแก้เสร็จ');
  process.exit(1);
}
console.log('ตรวจผ่านทั้งหมด พร้อม deploy');
