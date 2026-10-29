# Task: ตรวจกติกา Loop Engineering ด้วยเครื่อง ทั้งในเครื่องและใน CI

Status: เสร็จ

## Outcome

กติกาที่ตรวจด้วยเครื่องได้ (ลิงก์, `Status:`, คำสถานะ, HUMAN_CHECKS, RETRO) ถูกตรวจด้วยคำสั่งเดียว และ CI ไม่ผ่านเมื่อเอกสารผิดกติกา — ไม่ต้องพึ่งความจำของ AI หรือคนอีกต่อไป ซึ่งเป็นต้นเหตุที่พบใน [loop-robustness](2026-10-29-loop-robustness.md)

## Context and scope

- In scope:
  - `scripts/check-docs.mjs` และ test ของมัน
  - job ใหม่ใน `.github/workflows/verify.yml`
  - บอกวิธีใช้ใน AGENTS.md, BUILD_PROMPT.md, LOOP_WORKFLOW.md, README.md, HUMAN_CHECKS.md
  - แก้ข้อความกติกาเรื่อง `Status: เสร็จ` ที่ขัดกันเอง (พบตอนออกแบบตัวตรวจ: template กับ AGENTS.md บอกว่า "เสร็จ" ต้องไม่มีข้อตรวจโดยคน แต่ LOOP_WORKFLOW กับ HUMAN_CHECKS บอกให้เปลี่ยนเป็น "เสร็จ" หลังคนตรวจผ่าน ซึ่งตอนนั้นหัวข้อ "ตรวจโดยคน" ยังมีขั้นตอนอยู่)
- Out of scope: ตรวจเหตุผล `Not run` ที่ซ้ำ และข้อเสนอใน RETRO ที่ค้าง (ต้องใช้วิจารณญาณ), แก้ spec เก่าให้ใช้รูปแบบใหม่, ESLint, nutrition API
- Constraints:
  - ใช้แค่ Node ไม่มี package — `package.json` ที่ root ในเครื่องเป็นของ nutrition API ที่ยังไม่ได้ตัดสินใจ ห้ามแตะ
  - spec ก่อน 2026-10-29 เป็นบันทึกย้อนหลัง ไม่บังคับรูปแบบใหม่
  - job ของ OpenLoops ใน CI ต้องไม่เปลี่ยน

## Acceptance criteria

- [x] AC1 `node scripts/check-docs.mjs` ตรวจ 5 กลุ่มกติกา บอกไฟล์และเหตุผลเป็นภาษาไทย และ exit 1 เมื่อพบปัญหา:
  1. ลิงก์ relative ใน markdown ชี้ไปไฟล์ที่มีจริง ตัวพิมพ์ตรง และไม่ออกนอก repo (ไม่นับลิงก์ใน code)
  2. spec ตั้งแต่ 2026-10-29 มี `Status:` ที่ใช้ได้ และคำสถานะใน Validation plan อยู่ในชุดที่กำหนด
  3. `Status: เสร็จ` ต้องไม่มีเกณฑ์ค้าง; มี `Pass-จำลอง`/`ตรวจโดยคน` ต้องมีขั้นตอนในหัวข้อ "ตรวจโดยคน"
  4. เกณฑ์ที่ยังไม่ติ๊กของ spec ที่จบแล้ว ตรงกับข้อค้างใน `docs/HUMAN_CHECKS.md` ทั้งสองทาง
  5. spec ที่ครบ 3 รอบ / ติด blocker / มีข้อตรวจโดยคน มีลิงก์จาก `docs/RETRO.md`
- [x] AC2 test ของตัวตรวจ (`node --test scripts/check-docs.test.mjs`) มีทั้งเคสที่ต้องเจอปัญหาและเคสที่ต้องผ่าน ครบทุกกลุ่มกติกา
- [x] AC3 ตัวตรวจผ่านบน repo ปัจจุบัน ทั้งในโฟลเดอร์ทำงานและในสำเนาที่ export จาก git แบบที่ CI จะเห็น
- [x] AC4 `verify.yml` มี job `docs` ที่รัน test และตัวตรวจทุก push/PR ไป main; YAML ถูกต้อง; job ของ OpenLoops ไม่เปลี่ยน
- [x] AC5 AGENTS.md, BUILD_PROMPT.md, LOOP_WORKFLOW.md, README.md, HUMAN_CHECKS.md บอกให้รันตัวตรวจ และบอกว่าตรวจอะไร/ไม่ตรวจอะไร; ข้อความเรื่อง `Status: เสร็จ` ตรงกันทุกไฟล์ (เสร็จ = ทุกเกณฑ์ติ๊กแล้ว รวมข้อที่คนตรวจผ่านแล้ว)

## Validation plan

| Criterion | Evidence / command | Status | Notes |
| --- | --- | --- | --- |
| AC1 | test ของ AC2 + รันบนเอกสารจริงในสำเนา โดยติ๊ก `S9-AC4` ใน HUMAN_CHECKS | Pass | ขึ้น `docs/tasks/2026-09-25-openloops-9-desktop.md: เกณฑ์ AC4 ติ๊กใน docs/HUMAN_CHECKS.md แล้ว แต่ใน spec ยังไม่ติ๊ก` บอกตำแหน่งกติกา และ exit 1 |
| AC2 | `node --test scripts/check-docs.test.mjs` | Pass | 30 ผ่าน 0 ไม่ผ่าน ใน 5 กลุ่ม; ทดสอบกลับด้าน: เอาการแก้รอบ 2 ออกในสำเนา → เคสใหม่ไม่ผ่าน 1 เคสตามคาด |
| AC3 | `node scripts/check-docs.mjs` ในโฟลเดอร์ทำงาน + ในสำเนาจาก `git archive HEAD` ที่ทับด้วยไฟล์ของงานนี้ | Pass | โฟลเดอร์ทำงาน: ลิงก์ 71, spec 14 (รวม nutrition API ที่ยังไม่ commit); สำเนา: ไม่มีไฟล์ nutrition API, test 30/30 และตัวตรวจผ่าน ลิงก์ 70, spec 13 |
| AC4 | `git diff` ของ `verify.yml` + ตรวจโครงสร้าง (ไม่มี tab, ย่อหน้าเป็นคู่, `docs:` อยู่ระดับเดียวกับ `verify:`) | Pass | diff เป็นการเพิ่มต่อท้ายล้วน job เดิมไม่เปลี่ยน; ในเครื่องไม่มีตัว parse YAML (Python ไม่มี PyYAML) จึงยืนยันด้วยโครงสร้าง — GitHub จะ parse จริงตอน push |
| AC5 | `git diff` + grep ข้อความเดิม "None เท่านั้น" / "ไม่มีข้อตรวจโดยคน" / "ทุกเกณฑ์ Pass" | Pass | ไม่เหลือในไฟล์กติกา (เจอเฉพาะใน spec นี้ที่อธิบายปัญหา); LOOP_WORKFLOW มีหัวข้อ "8) ตรวจกติกาด้วยเครื่อง" พร้อมตารางสิ่งที่ตรวจและส่วนที่ยังต้องใช้วิจารณญาณ |
| CI บน GitHub | หน้า Actions หลัง push | Not run | ต้อง push ก่อน (รอคำสั่ง); รันคำสั่งเดียวกันบนสำเนาจาก git แล้วตาม AC3 |
| แอป | `apps/openloops` typecheck/test/build | Not run | ไม่ได้แตะโค้ดแอป; job ของแอปใน CI ไม่เปลี่ยน |

## Loop log

| Round | Change / finding | Validation result | Next decision |
| --- | --- | --- | --- |
| 0 | ผู้ใช้สั่งให้ย้ายตัวตรวจเข้า repo และให้ CI รัน (2026-10-29); ตอนออกแบบกฎพบว่ากติกาเรื่อง `Status: เสร็จ` ขัดกันเอง จึงรวมการแก้ข้อความไว้ใน spec นี้ | — | Implement |
| 1 | `scripts/check-docs.mjs` (5 กลุ่มกติกา), `scripts/check-docs.test.mjs` (29 เคส), job `docs` ใน `verify.yml` | `node --test scripts/check-docs.test.mjs`: 29 ผ่าน 0 ไม่ผ่าน; `node scripts/check-docs.mjs`: ผ่าน (ลิงก์ 68, spec 14) | ค้าง (หยุดเพราะ usage limit): AC5 แก้เอกสาร, ตรวจ YAML, จำลอง CI บนสำเนาจาก git, อัปเดต Validation plan และ Status |
| 2 | ทบทวนกฎพบว่า spec เดิมที่ใส่ `Status: เสร็จ–รอคนตรวจ` ทีหลังจะโดนแจ้งว่าไม่มีหัวข้อ "ตรวจโดยคน" ทั้งที่ spec เดิมเก็บขั้นตอนไว้ใน Human decision needed → จำกัดกฎนั้นเฉพาะ spec ใหม่ + test; แก้ข้อความ `เสร็จ` ใน template/AGENTS.md, ใส่รหัส AC ใน template, หัวข้อ 8 ใน LOOP_WORKFLOW และบอกวิธีใช้ใน BUILD_PROMPT/README/HUMAN_CHECKS/tasks README/RETRO | test 30/30; ตัวตรวจผ่านทั้งโฟลเดอร์ทำงานและสำเนาจาก git; ติ๊กข้อเดียวในสำเนาแล้วตัวตรวจจับได้ | จบงาน |

## ตรวจโดยคน

None

## Human decision needed

ข้อเสนอใน RETRO ที่ครบกำหนดตามกติกา "ภายใน spec ถัดไป" — ต้องเลือกทำหรือไม่ทำ (ถ้าทำแต่ละข้อเป็น spec แยก):

1. เปิด spec ตั้ง ESLint ให้ OpenLoops — Lint เป็น `Not run` มาครบ 10 spec (แนะนำ: ทำ เพราะเป็นช่องว่างที่ค้างนานที่สุด)
2. ชุดข้อมูลตัวอย่างที่โหลดซ้ำได้ด้วยคำสั่งเดียวสำหรับตรวจใน browser — ทุก spec ต้องสร้างข้อมูลทดสอบด้วยมือ และเคยหายกลางทางใน spec 5 (แนะนำ: ทำหลัง ESLint)
