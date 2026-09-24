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

## ตรวจ

```bash
npm run typecheck
npm test
npm run build
```

## โครงสร้าง

- `src/domain/` — กติกาของลูป (สร้าง, ติ๊กขั้น, เปลี่ยนสถานะ, เลื่อน, ยกข้ามวัน), เวลาว่างของวัน (`capacity.ts`) และวันที่ เป็นฟังก์ชันล้วน มี test
- `src/db.ts` — Dexie/IndexedDB (v2: loops, days, settings — settings มีวันทำงาน)
- `src/components/` — ฟอร์มจดงาน, การ์ดลูป, แผงวันนี้, บอร์ดสัปดาห์ (`#week`), ปุ่มตัวเลือก
- `scripts/make-icons.mjs` — สร้างไอคอน PNG ของ PWA (`npm run icons`)
