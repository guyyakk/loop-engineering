# OpenLoops

Planner ที่ไม่ยอมให้งานค้างกลางทาง — PWA ใช้คนเดียว เก็บข้อมูลใน IndexedDB ของเครื่อง ไม่มี server

แนวคิดและแผนทั้งหมดอยู่ที่ [docs/tasks/2026-09-24-openloops-0-epic.md](../../docs/tasks/2026-09-24-openloops-0-epic.md)

## รัน

```bash
npm install
npm run dev        # พัฒนา (http://localhost:5173)
npm run build && npm run preview   # ลองแบบ PWA จริง (http://localhost:4173)
```

ติดตั้งเป็นแอปบน Windows: เปิดหน้า preview ใน Chrome หรือ Edge แล้วกดไอคอนติดตั้งท้ายช่อง URL

ข้อมูลอยู่ใน browser ของเครื่องนั้นเท่านั้น สำรองเป็นไฟล์ได้ที่ "ข้อมูลและการสำรอง" (ลิงก์ท้ายหน้า หรือ `#data`) และนำไฟล์ไปนำเข้าในเครื่องอื่นได้

## ตรวจ

```bash
npm run typecheck
npm test
npm run build
```

## โครงสร้าง

- `src/domain/` — กติกาของลูป (สร้าง, ติ๊กขั้น, เปลี่ยนสถานะ, เลื่อน, ยกข้ามวัน), เวลาว่างของวัน (`capacity.ts`) และวันที่ เป็นฟังก์ชันล้วน มี test
- `src/db.ts` — Dexie/IndexedDB (v2: loops, days, settings — settings มีวันทำงาน)
- `src/domain/nudges.ts` — กติกาการเตือน (เลยกำหนด, ต้องเริ่มวันนี้, ตามงาน, ลูปนิ่ง), ข้อความตามงาน และเวลาแจ้งเตือน
- `src/domain/backup.ts` — รูปแบบไฟล์สำรอง ตรวจไฟล์ก่อนนำเข้า รวม/แทนที่ และการเตือนให้สำรอง (หน้า `#data`)
- `src/domain/rituals.ts` — การตัดสินใจตอนปิดวัน (`#shutdown`) และทบทวนสัปดาห์ (`#review`)
- `src/notifier.ts` + `public/sw-notify.js` — แจ้งเตือนบนเครื่อง (ทำงานเฉพาะตอนที่แอปเปิดอยู่ เพราะไม่มี server)
- `src/components/` — ฟอร์มจดงาน, การ์ดลูป, กล่องสิ่งที่ต้องดู, แผงวันนี้, บอร์ดสัปดาห์ (`#week`), หน้าปิดวันและทบทวนสัปดาห์, ปุ่มตัวเลือก
- `scripts/make-icons.mjs` — สร้างไอคอน PNG ของ PWA (`npm run icons`)
