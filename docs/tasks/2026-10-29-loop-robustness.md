# Task: ทำให้กระบวนการ Loop Engineering ซ่อมตัวเองได้

Status: เสร็จ

## Outcome

หลังจบแต่ละ spec ผู้ใช้เห็นได้ทันทีว่างานไหนเสร็จจริง งานไหนรอคนทดสอบ และงานที่ค้างทดสอบทั้งหมดอยู่ในรายการเดียวที่ติ๊กได้; ปัญหาที่เกิดซ้ำถูกบันทึกและนำไปปรับกติกา ไม่ใช่หายไปในไฟล์ spec

## Context and scope

- In scope:
  - template, AGENTS.md, LOOP_WORKFLOW.md, BUILD_PROMPT.md: สถานะ spec, คำสถานะที่ใช้ได้, หัวข้อ "ตรวจโดยคน", ข้อบังคับบันทึก RETRO ก่อนจบงาน
  - `docs/HUMAN_CHECKS.md` รวมเกณฑ์ที่รอคนทดสอบจาก spec 4–10
  - เติม RETRO ย้อนหลังให้ครบเหตุการณ์ที่ตกหล่น
- Out of scope: แก้ spec เก่าทีละไฟล์ให้ใช้รูปแบบใหม่, ตั้ง ESLint, ตัดสินใจเรื่อง nutrition API (untracked), นิยามการนับรอบแก้
- Constraints: แก้เอกสารเท่านั้น ไม่แตะโค้ดใน `apps/`

## ที่มา (ตรวจ spec ทั้ง 11 ไฟล์ 2026-10-29)

- RETRO มี 1 แถว แต่มีเหตุการณ์ที่ต้องบันทึกตามกติกาอย่างน้อย 5 ครั้ง; ข้อเสนอของ spec 4 ไม่เคยถูกนำไปใช้ และปัญหาเดิมเกิดซ้ำใน spec 5, 7, 8, 9, 10
- เกณฑ์ที่ยังไม่ติ๊กรวม 10 ข้อ กระจายอยู่ 5 ไฟล์ ไม่มีที่รวม
- คำสถานะที่ใช้จริงมี `Passed`, `Partial`, `Pass (API จำลอง)`, `Pass (หน้าเว็บ)` นอกเหนือจาก template
- Lint เป็น `Not run` 10/10 spec โดยไม่เคยเปิดเป็นงาน

## Acceptance criteria

- [x] AC1 `templates/TASK_SPEC.md` มีบรรทัด `Status:` พร้อมค่าที่ใช้ได้, ตารางคำสถานะที่ใช้ได้ (ไม่มี `Partial`), และหัวข้อ "ตรวจโดยคน" ที่บังคับให้เขียนขั้นตอนทดสอบ
- [x] AC2 `AGENTS.md`, `docs/LOOP_WORKFLOW.md` และ `templates/BUILD_PROMPT.md` บังคับให้ก่อนจบงาน: ตั้ง `Status:`, ย้ายข้อ "ตรวจโดยคน" ไป `docs/HUMAN_CHECKS.md`, และเพิ่มแถว RETRO เมื่อครบ 3 รอบ / ติด blocker / มีข้อตรวจโดยคน / `Not run` ซ้ำจาก spec ก่อน
- [x] AC3 `docs/HUMAN_CHECKS.md` เป็น checklist ที่มีทุกเกณฑ์ที่ยังไม่ติ๊กใน spec 4–10 (10 ข้อ) พร้อมขั้นตอนทดสอบและลิงก์กลับไป spec
- [x] AC4 `docs/RETRO.md` มีแถวของ spec 1, 5, 7, 8, 9, 10 และแถวสรุปการตรวจครั้งนี้; แถว spec 4 บอกว่านำข้อเสนอไปใช้แล้ว
- [x] AC5 ลิงก์ภายในใน markdown ที่แก้/เพิ่มชี้ไปไฟล์ที่มีอยู่จริงทั้งหมด

## Validation plan

| Criterion | Evidence / command | Status | Notes |
| --- | --- | --- | --- |
| AC1 | อ่าน diff + grep ใน template | Pass | มี `Status:` 1 บรรทัด, หัวข้อ `## ตรวจโดยคน` 1 หัวข้อ, ตารางคำสถานะ 5 คำ ไม่มี `Partial` เป็นสถานะ |
| AC2 | grep `HUMAN_CHECKS`, `RETRO`, `Status:` ใน 3 ไฟล์ | Pass | ทั้ง 3 ไฟล์มีครบทั้ง 3 คำ; `REVIEW_PROMPT.md` ตรวจ `Status:` และ `Pass-จำลอง` เพิ่ม |
| AC3 | `node check-docs.mjs <repo>` (สคริปต์ชั่วคราวใน scratchpad ของ session) | Pass | เกณฑ์ที่ยังไม่ติ๊กใน spec 4–10 = 10, อยู่ใน HUMAN_CHECKS = 10, ขาด 0; ทดสอบกลับด้านโดยลบ `S9-AC4` ในสำเนา → สคริปต์รายงาน `MISSING S9-AC4` และ exit 1. ขั้นตอนแจ้งเตือนเทียบกับ `pendingNotifications` ใน `apps/openloops/src/domain/nudges.ts` แล้ว |
| AC4 | อ่าน diff ของ RETRO | Pass | เพิ่มแถว spec 1, 5, 7, 8, 9, 10 และแถวสรุปครั้งนี้; แถว spec 4 เป็น "ปรับแล้ว 2026-10-29" พร้อมไฟล์ที่แก้ |
| AC5 | สคริปต์เดียวกัน ตรวจลิงก์ relative ใน `*.md` ทั้ง repo (ยกเว้น `node_modules`, `dist*`, `target`, `.git`) | Pass | 121 ลิงก์, เสีย 0; สำเนาที่ตัดไฟล์ออกรายงานลิงก์เสีย 2 ตามคาด |
| แอป | `apps/openloops` typecheck/test/build | Not run | ไม่ได้แตะโค้ดแอปหรือไฟล์ที่แอปใช้ |

## Loop log

| Round | Change / finding | Validation result | Next decision |
| --- | --- | --- | --- |
| 0 | ผู้ใช้สั่งให้ทำข้อ 1–3 จากการตรวจ (2026-10-29) | — | Implement |
| 1 | แก้ template/AGENTS/LOOP_WORKFLOW/BUILD_PROMPT/REVIEW_PROMPT/README, สร้าง `HUMAN_CHECKS.md`, เติม RETRO; ระหว่างเขียนพบว่าขั้นตอนทดสอบแจ้งเตือนที่ร่างไว้ไม่ตรงกติกาในโค้ด จึงแก้ตาม `nudges.ts` ก่อนตรวจ | AC1–AC5 ผ่าน | จบงาน |

## ตรวจโดยคน

None

## Human decision needed

None
