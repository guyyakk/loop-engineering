# Task: OpenLoops 1 — จดงานและรายการลูป

> spec ย่อยที่ 1 ของ [2026-09-24-openloops-0-epic.md](2026-09-24-openloops-0-epic.md)

## Outcome

ผู้ใช้จดงานใหม่ได้ภายในไม่กี่วินาทีผ่านฟอร์มที่กดเลือกเป็นส่วนใหญ่ แล้วเห็นงานทุกชิ้นเป็น "ลูป" ที่บอกว่าอยู่ขั้นไหน ขั้นถัดไปคืออะไร และสถานะเป็นอย่างไร ข้อมูลอยู่ในเครื่องและไม่หายเมื่อเปิดใหม่

## Context and scope

- In scope:
  - โครงโปรเจกต์ PWA ที่ `apps/openloops/` (Vite + React + TypeScript, เก็บข้อมูลใน IndexedDB ด้วย Dexie)
  - ฟอร์มจดงาน/แก้ไขงาน, รายการลูปแยกตาม วันนี้ / สัปดาห์นี้ / ไว้ก่อน / ปิดแล้ว
  - ติ๊กขั้นตอน, เปลี่ยนสถานะ 5 แบบ, ย้ายช่วงเวลา
  - ปรับ CI (`.github/workflows/verify.yml`) ให้รัน typecheck/test/build ของแอป
- Out of scope: แถบเวลาว่าง (spec 2), หน้าสัปดาห์ (spec 3), การเตือน/notification (spec 4), ปิดวัน/ทบทวนสัปดาห์ (spec 5), แม่แบบ process, sync ข้ามเครื่อง, ลบถาวร
- Constraints: ใช้คนเดียว, ไม่มี server, UI ภาษาไทย, ผู้ใช้ไม่ต้องกรอกโครงข้อมูลดิบ (ใช้ปุ่ม/ตัวเลือกแทนการพิมพ์ให้มากที่สุด)

## Acceptance criteria

- [x] AC1 ฟอร์มจดงาน: สร้างลูปได้ด้วยชื่องานอย่างเดียว (พิมพ์แล้วกด Enter); ช่วงเวลา กำหนดส่ง เวลาที่ใช้ และลักษณะงานเลือกด้วยปุ่ม; เพิ่มขั้นตอนได้; ถ้าชื่อว่างจะแสดง error ใต้ช่องและไม่บันทึก
- [x] AC2 รายการลูปแยกกลุ่ม วันนี้ / สัปดาห์นี้ / ไว้ก่อน / ปิดแล้ว; แต่ละลูปแสดงความคืบหน้าของขั้น (n/m), ขั้นถัดไป, สถานะ และกำหนดส่ง
- [x] AC3 ติ๊กขั้นแล้วความคืบหน้าและขั้นถัดไปอัปเดตทันที พร้อมบันทึกเวลาที่ขยับล่าสุด; ติ๊กขั้นสุดท้ายแล้วลูปเป็น "เสร็จ" และกดเลิกทำได้
- [x] AC4 เปลี่ยนสถานะได้ 5 แบบ (กำลังทำ / รอคนอื่น / ติดขัด / เสร็จ / ทิ้ง); "รอคนอื่น" ต้องระบุว่ารอใครและวันตามงานก่อนบันทึก; ลูปที่เสร็จหรือทิ้งย้ายไปกลุ่มปิดแล้ว ไม่หายจากระบบ และเปิดกลับได้
- [x] AC5 ข้อมูลยังอยู่ครบหลัง reload หน้า
- [x] AC6 `npm run typecheck`, `npm test` และ `npm run build` ผ่าน และ build ได้ web manifest กับ service worker
- [x] AC7 ใช้งานได้ที่ความกว้าง 375px โดยไม่มี scroll แนวนอน และอ่านได้ทั้งโหมดสว่างและโหมดมืด

## Validation plan

| Criterion | Evidence / command | Status | Notes |
| --- | --- | --- | --- |
| AC1 | `CaptureForm.test.tsx` 3 เคส + browser pane: กดบันทึกตอนชื่อว่าง, กด N แล้วพิมพ์ + Enter, จดงานพร้อม chip และ 4 ขั้น | Pass | ขั้นที่พิมพ์ค้างไว้ในช่องโดยไม่กด Enter ถูกบันทึกด้วย |
| AC2 | browser pane: สร้าง 3 ลูปใน 2 ช่วงเวลา แล้วอ่าน DOM ของแต่ละกลุ่ม | Pass | การ์ดแสดง "ขั้น 2/4 · ต่อไป: …", ป้ายสถานะ, วันส่ง |
| AC3 | `loop.test.ts` (toggleStep/advance) + browser pane: ติ๊กขั้นจากปุ่มบนการ์ด, ปิดลูป, กดเลิกทำ | Pass | |
| AC4 | `loop.test.ts` (setStatus/validateWaiting) + browser pane: รอคนอื่นโดยไม่ใส่ชื่อ → error, ใส่ชื่อ → บันทึก; ทิ้ง → กลุ่มปิดแล้ว → เปิดกลับเป็นกำลังทำ | Pass | |
| AC5 | `db.test.ts` (ปิดแล้วเปิดฐานข้อมูลใหม่ด้วย fake-indexeddb) + reload ใน browser pane หลายครั้ง | Pass | สถานะรอคนอื่น, ลูปที่ปิด และลูปที่เปิดกลับ อยู่ครบ |
| AC6 | `npm ci && npm run typecheck && npm test && npm run build` | Pass | 4 files / 27 tests; `dist/` มี `manifest.webmanifest`, `sw.js`, ไอคอน 192/512/maskable |
| AC7 | browser pane 375×812 ทั้ง light และ dark: `document.documentElement.scrollWidth === 375` | Pass | ฟอร์มเป็น bottom sheet และปุ่มบันทึกติดอยู่ล่างจอ |
| CI | `.github/workflows/verify.yml` | Not run | GitHub Actions รันได้เมื่อ push/PR เท่านั้น; ตรวจ YAML ด้วย js-yaml และรันขั้นตอนเดียวกันในเครื่องแล้ว |
| Lint | — | Not run | ยังไม่ได้ตั้ง ESLint ในรอบนี้ ใช้ `tsc --strict` แทน |

## Loop log

| Round | Change / finding | Validation result | Next decision |
| --- | --- | --- | --- |
| 0 | ผู้ใช้เลือก PWA + ใช้คนเดียว (2026-09-24) | — | Implement |
| 1 | โครง PWA, domain (`loop.ts`, `dates.ts`), Dexie, ฟอร์มจดงาน, การ์ดลูป, ไอคอน, test 27 เคส | typecheck/test/build ผ่าน; browser pane พบว่ากด N แล้วพิมพ์ทันทีไม่ติด เพราะ `showModal()` ย้าย focus ไปปุ่มปิด แล้ว Enter จึงปิดฟอร์ม | แก้ focus |
| 2 | หลัง `showModal()` ย้าย focus ไปช่องชื่องาน (`data-autofocus`) | กด N → พิมพ์ → Enter สร้างลูปได้; AC2–AC5 ผ่านใน browser pane | ตรวจจอมือถือ |
| 3 | จอ 375px: ปุ่มบันทึกตกขอบล่าง ต้องเลื่อนหา → ทำ footer ของฟอร์มให้ sticky | ปุ่มอยู่ในจอ (bottom 811/812); รันชุดตรวจครบอีกรอบผ่าน | จบงาน (ครบ 3 รอบพอดี) |

## Human decision needed

None สำหรับ spec นี้ — โค้ดอยู่ที่ `apps/openloops/` ตามค่าเริ่มต้น (ย้ายไป repo ใหม่ภายหลังได้)

ข้อสังเกตส่งต่อ spec 4: ปุ่ม "อีก 3 วัน" ของวันตามงานนับวันเสาร์-อาทิตย์ด้วย ควรเปลี่ยนเป็นวันทำการเมื่อทำระบบเตือน
