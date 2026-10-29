// test ของ scripts/check-docs.mjs: ทุกกติกามีเคสที่ต้องเจอปัญหาและเคสที่ต้องผ่าน
// รัน: node --test scripts/check-docs.test.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, test } from 'node:test'
import { checkDocs } from './check-docs.mjs'

const roots = []
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })))

/** สร้าง repo จำลองจาก path → เนื้อหา แล้วคืนปัญหาที่ตัวตรวจเจอเป็นข้อความ "ไฟล์: ข้อความ" */
function problems(files) {
  const root = mkdtempSync(join(tmpdir(), 'check-docs-'))
  roots.push(root)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return checkDocs(root).problems.map(({ file, message }) => `${file}: ${message}`)
}

/** spec ขั้นต่ำที่ผ่านทุกกติกา แต่ละเคสเปลี่ยนเฉพาะส่วนที่ต้องการ */
function spec({ status = 'เสร็จ', criteria = ['- [x] AC1 ทำได้'], checks = ['| AC1 | `npm test` | Pass | |'], rounds = [0, 1], human = 'None' } = {}) {
  return [
    '# Task: ตัวอย่าง',
    '',
    status === null ? '' : `Status: ${status}`,
    '',
    '## Acceptance criteria',
    '',
    ...criteria,
    '',
    '## Validation plan',
    '',
    '| Criterion | Evidence / command | Status | Notes |',
    '| --- | --- | --- | --- |',
    ...checks,
    '',
    '## Loop log',
    '',
    '| Round | Change / finding | Validation result | Next decision |',
    '| --- | --- | --- | --- |',
    ...rounds.map((round) => `| ${round} | แก้ | ผ่าน | ต่อ |`),
    '',
    '## ตรวจโดยคน',
    '',
    human,
    '',
  ].join('\n')
}

const NEW = 'docs/tasks/2026-11-02-new.md'
const OLD = 'docs/tasks/2026-09-01-old.md'
const fromDocs = (path) => path.replace(/^docs\//, '')
const retro = (...specs) => ['# Retro log', '', ...specs.map((path) => `| 2026-11-02 | [spec](${fromDocs(path)}) |`)].join('\n')
const humanChecks = (...items) => ['# รายการที่รอคนตรวจ', '', ...items].join('\n')
const item = (done, text, path) => `- [${done ? 'x' : ' '}] ${text} — [spec](${fromDocs(path)})`

/** spec ใหม่ที่รอคนตรวจ AC2 ครบตามกติกา (มีขั้นตอน, มีข้อค้างใน HUMAN_CHECKS, มีแถว RETRO) */
const waiting = (overrides = {}) => ({
  [NEW]: spec({
    status: 'เสร็จ–รอคนตรวจ',
    criteria: ['- [x] AC1 ส่วนที่ AI ตรวจได้', '- [ ] AC2 ลองกับบัญชีจริง'],
    checks: ['| AC1 | API จำลอง | Pass-จำลอง | |', '| AC2 | ขั้นตอนในหัวข้อตรวจโดยคน | ตรวจโดยคน | |'],
    human: '- เปิดแอป ล็อกอินบัญชีจริง แล้วกดเชื่อมต่อ',
  }),
  'docs/HUMAN_CHECKS.md': humanChecks(item(false, '**S1-AC2** ลองกับบัญชีจริง', NEW)),
  'docs/RETRO.md': retro(NEW),
  ...overrides,
})

describe('ลิงก์', () => {
  test('ลิงก์ที่ชี้ไปไฟล์ที่มีอยู่ผ่าน รวมลิงก์ภายนอก anchor และลิงก์ใน code', () => {
    assert.deepEqual(
      problems({
        'README.md': '[a](docs/a.md) [b](https://example.com/x) [c](#top) [d](mailto:a@b.c) `[e](missing.md)`\n\n```\n[f](missing.md)\n```\n',
        'docs/a.md': '[กลับ](../README.md)',
      }),
      [],
    )
  })

  test('ลิงก์ไปไฟล์ที่ไม่มี', () => {
    assert.match(problems({ 'README.md': 'ดู [a](docs/missing.md)' }).join('\n'), /^README\.md: ลิงก์เสีย "docs\/missing\.md" — ไม่มีไฟล์นี้$/)
  })

  test('ตัวพิมพ์ไม่ตรงกับชื่อไฟล์จริงถือว่าเสีย แม้ Windows จะหาเจอ', () => {
    assert.match(problems({ 'README.md': '[a](docs/A.md)', 'docs/a.md': '' }).join('\n'), /ตัวพิมพ์ไม่ตรง/)
  })

  test('ลิงก์ออกนอก repo และ path ของเครื่อง', () => {
    const found = problems({ 'README.md': '[a](../outside.md) [b](C:\\Users\\me\\x.md)' }).join('\n')
    assert.match(found, /ชี้ออกนอก repo/)
    assert.match(found, /path ของเครื่องนี้/)
  })

  test('ข้ามโฟลเดอร์ของเครื่องมือและของที่ build ขึ้นมา', () => {
    assert.deepEqual(problems({ '.claude/x.md': '[a](missing.md)', 'node_modules/p/README.md': '[a](missing.md)' }), [])
  })

  test('ไม่มีโฟลเดอร์ docs ก็ไม่พัง', () => {
    assert.deepEqual(problems({ 'README.md': '# ว่าง' }), [])
  })
})

describe('รูปแบบ spec', () => {
  test('spec ใหม่ที่ถูกต้องผ่าน', () => {
    assert.deepEqual(problems({ [NEW]: spec() }), [])
  })

  test('spec ใหม่ต้องมี Status ที่อยู่ในชุด', () => {
    assert.match(problems({ [NEW]: spec({ status: null }) }).join('\n'), /ไม่มีบรรทัด Status:/)
    assert.match(problems({ [NEW]: spec({ status: 'done' }) }).join('\n'), /Status "done" ใช้ไม่ได้/)
  })

  test('คำสถานะนอกชุดใน Validation plan', () => {
    const found = problems({ [NEW]: spec({ checks: ['| AC1 | x | Partial | |', '| CI | x | Pass (API จำลอง) | |'] }) })
    assert.equal(found.length, 2)
    assert.match(found[0], /คำสถานะ "Partial" ในแถว "AC1"/)
    assert.match(found[1], /คำสถานะ "Pass \(API จำลอง\)" ในแถว "CI"/)
  })

  test('ขีดแบบต่าง ๆ ตัวพิมพ์ และตัวหนาไม่ทำให้ผิด', () => {
    const files = waiting()
    files[NEW] = files[NEW].replace('Status: เสร็จ–รอคนตรวจ', '**Status:** เสร็จ-รอคนตรวจ').replace('Pass-จำลอง', 'pass–จำลอง')
    assert.deepEqual(problems(files), [])
  })

  test('spec เดิม (ก่อนวันเริ่มใช้รูปแบบใหม่) ไม่บังคับ Status และคำสถานะ', () => {
    assert.deepEqual(problems({ [OLD]: spec({ status: null, checks: ['| AC1 | x | Partial | |'] }) }), [])
  })

  test('spec เดิมที่ใส่ Status ทีหลังถูกตรวจค่า', () => {
    assert.match(problems({ [OLD]: spec({ status: 'เสร็จแล้ว' }) }).join('\n'), /Status "เสร็จแล้ว" ใช้ไม่ได้/)
  })
})

describe('Status กับเกณฑ์', () => {
  test('เสร็จ แต่ยังมีเกณฑ์ที่ไม่ติ๊ก', () => {
    const found = problems({ [NEW]: spec({ criteria: ['- [x] AC1 ทำได้', '- [ ] AC2 ยังไม่ได้ทำ'] }) })
    assert.deepEqual(found, [`${NEW}: Status: เสร็จ แต่ยังมีเกณฑ์ที่ไม่ติ๊ก: AC2`])
  })

  test('Pass-จำลอง ต้องมีขั้นตอนในหัวข้อตรวจโดยคน', () => {
    assert.match(problems({ [NEW]: spec({ checks: ['| AC1 | API จำลอง | Pass-จำลอง | |'] }) }).join('\n'), /Pass-จำลอง หรือ ตรวจโดยคน/)
  })

  test('รอคนตรวจ ต้องมีขั้นตอนในหัวข้อตรวจโดยคน', () => {
    const files = waiting()
    files[NEW] = files[NEW].replace('- เปิดแอป ล็อกอินบัญชีจริง แล้วกดเชื่อมต่อ', 'None')
    assert.match(problems(files).join('\n'), /Status: เสร็จ–รอคนตรวจ แต่หัวข้อ "ตรวจโดยคน" ไม่มีขั้นตอน/)
  })

  test('spec เดิมที่ใส่ Status: เสร็จ–รอคนตรวจ ทีหลังไม่ต้องมีหัวข้อตรวจโดยคน', () => {
    const files = {
      [OLD]: spec({ status: 'เสร็จ–รอคนตรวจ', criteria: ['- [x] AC1 ทำได้', '- [ ] AC2 ลองจริง'] }),
      'docs/HUMAN_CHECKS.md': humanChecks(item(false, '**S0-AC2** ลองจริง', OLD)),
      'docs/RETRO.md': retro(OLD),
    }
    assert.deepEqual(problems(files), [])
  })

  test('เปลี่ยนเป็นเสร็จหลังคนตรวจผ่าน ทั้งที่หัวข้อตรวจโดยคนยังมีขั้นตอนอยู่ ผ่าน', () => {
    const files = waiting({ 'docs/HUMAN_CHECKS.md': humanChecks(item(true, '**S1-AC2** ลองกับบัญชีจริง', NEW)) })
    files[NEW] = files[NEW].replace('Status: เสร็จ–รอคนตรวจ', 'Status: เสร็จ').replace('- [ ] AC2', '- [x] AC2')
    assert.deepEqual(problems(files), [])
  })
})

describe('HUMAN_CHECKS', () => {
  test('รอคนตรวจที่ครบกติกาผ่าน', () => {
    assert.deepEqual(problems(waiting()), [])
  })

  test('เกณฑ์ที่ยังไม่ติ๊กต้องมีข้อค้าง', () => {
    const found = problems(waiting({ 'docs/HUMAN_CHECKS.md': humanChecks() })).join('\n')
    assert.match(found, /เกณฑ์ AC2 ยังไม่ติ๊ก แต่ไม่มีข้อค้างใน docs\/HUMAN_CHECKS\.md/)
    assert.match(found, /Status: เสร็จ–รอคนตรวจ แต่ไม่มีข้อค้าง/)
  })

  test('ติ๊กใน HUMAN_CHECKS แล้ว แต่ลืมติ๊กใน spec', () => {
    const found = problems(waiting({ 'docs/HUMAN_CHECKS.md': humanChecks(item(true, '**S1-AC2** ลองกับบัญชีจริง', NEW)) }))
    assert.match(found.join('\n'), /เกณฑ์ AC2 ติ๊กใน docs\/HUMAN_CHECKS\.md แล้ว แต่ใน spec ยังไม่ติ๊ก/)
  })

  test('ติ๊กใน spec แล้ว แต่ลืมติ๊กใน HUMAN_CHECKS', () => {
    const files = waiting()
    files[NEW] = files[NEW].replace('Status: เสร็จ–รอคนตรวจ', 'Status: เสร็จ').replace('- [ ] AC2', '- [x] AC2')
    assert.deepEqual(problems(files), [`docs/HUMAN_CHECKS.md: AC2 ของ ${NEW} ติ๊กใน spec แล้ว แต่ที่นี่ยังไม่ติ๊ก`])
  })

  test('อ้างเกณฑ์ที่ไม่มีใน spec', () => {
    const files = waiting({
      'docs/HUMAN_CHECKS.md': humanChecks(item(false, '**S1-AC2** ลองจริง', NEW), item(false, '**S1-AC9** ไม่มีข้อนี้', NEW)),
    })
    assert.deepEqual(problems(files), [`docs/HUMAN_CHECKS.md: อ้าง AC9 ซึ่งไม่มีใน ${NEW}`])
  })

  test('spec เดิมที่ไม่มี Status ถือว่าจบแล้ว เกณฑ์ค้างต้องอยู่ใน HUMAN_CHECKS', () => {
    const files = { [OLD]: spec({ status: null, criteria: ['- [ ] AC1 ลองจริง'] }), 'docs/RETRO.md': retro(OLD) }
    assert.match(problems(files).join('\n'), /เกณฑ์ AC1 ยังไม่ติ๊ก/)
    files['docs/HUMAN_CHECKS.md'] = humanChecks(item(false, '**S0-AC1** ลองจริง', OLD))
    assert.deepEqual(problems(files), [])
  })

  test('เกณฑ์ที่ไม่มีรหัสนับจำนวนแทน', () => {
    const files = { [OLD]: spec({ status: null, criteria: ['- [ ] ลองบนมือถือจริง'] }), 'docs/RETRO.md': retro(OLD) }
    assert.match(problems(files).join('\n'), /เกณฑ์ไม่มีรหัสที่ยังไม่ติ๊ก 1 ข้อ แต่มีข้อค้างใน docs\/HUMAN_CHECKS\.md แค่ 0 ข้อ/)
    files['docs/HUMAN_CHECKS.md'] = humanChecks(item(false, 'ลองบนมือถือจริง', OLD))
    assert.deepEqual(problems(files), [])
  })

  test('เสร็จ แต่ยังมีข้อค้างที่ไม่มีรหัส', () => {
    const files = { [NEW]: spec(), 'docs/HUMAN_CHECKS.md': humanChecks(item(false, 'ลองบนเครื่องจริง', NEW)) }
    assert.deepEqual(problems(files), [`${NEW}: Status: เสร็จ แต่ docs/HUMAN_CHECKS.md ยังมีข้อค้างของ spec นี้`])
  })

  test('กำลังทำอยู่ เกณฑ์ที่ยังไม่ติ๊กไม่ต้องอยู่ใน HUMAN_CHECKS และไม่ต้องมี RETRO', () => {
    assert.deepEqual(problems({ [NEW]: spec({ status: 'กำลังทำ', criteria: ['- [ ] AC1 ยังทำอยู่'], rounds: [0, 1, 2, 3] }) }), [])
  })
})

describe('RETRO', () => {
  test('ครบ 3 รอบต้องมีแถวใน RETRO', () => {
    const files = { [NEW]: spec({ rounds: [0, 1, 2, 3] }) }
    assert.deepEqual(problems(files), [`${NEW}: ต้องมีแถวใน docs/RETRO.md ที่ลิงก์มาที่ spec นี้ (ครบ 3 รอบแก้)`])
    files['docs/RETRO.md'] = retro(NEW)
    assert.deepEqual(problems(files), [])
  })

  test('แถวที่ไม่ใช่ตัวเลขใน Loop log ไม่นับเป็นรอบ', () => {
    assert.deepEqual(problems({ [NEW]: spec({ rounds: [0, 1, '—'] }) }), [])
  })

  test('ติด blocker ต้องมีแถวใน RETRO', () => {
    const found = problems({ [NEW]: spec({ status: 'ติด blocker', criteria: ['- [ ] AC1 รอเครื่องมือ'] }) })
    assert.deepEqual(found, [`${NEW}: ต้องมีแถวใน docs/RETRO.md ที่ลิงก์มาที่ spec นี้ (ติด blocker)`])
  })

  test('มีข้อตรวจโดยคนต้องมีแถวใน RETRO', () => {
    assert.deepEqual(problems(waiting({ 'docs/RETRO.md': retro() })), [
      `${NEW}: ต้องมีแถวใน docs/RETRO.md ที่ลิงก์มาที่ spec นี้ (มีข้อตรวจโดยคน)`,
    ])
  })
})
