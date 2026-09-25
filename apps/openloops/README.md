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

เชื่อม Google Calendar (ไม่บังคับ): ใน "ตั้งเวลาและการแจ้งเตือน" → Google Calendar ใส่ OAuth Client ID ของคุณเอง (มีวิธีสร้างทีละขั้นในแอป; Authorized JavaScript origins ต้องเป็น origin ที่เปิดแอป เช่น `http://localhost:4173`) แอปขอแค่สิทธิ์ `calendar.freebusy` เห็นเฉพาะช่วงไม่ว่าง เก็บแค่จำนวนนาทีต่อวัน token อยู่ในหน่วยความจำเท่านั้น ปิดแอปแล้วต้องกด "ซิงก์อีกครั้ง"

ผู้ช่วย AI (ไม่บังคับ): ใน "ตั้งเวลาและการแจ้งเตือน" → ผู้ช่วย AI ใส่ Claude API key ของคุณเอง (สร้างที่ console.anthropic.com และตั้งวงเงินไว้) แล้วจะมีปุ่ม "ให้ AI แยกรายละเอียด" / "ให้ AI ช่วยแตกขั้น" ในฟอร์มจดงาน และ "ให้ AI จัดแผนวันนี้" ในหน้าวันนี้ key เก็บเฉพาะในเครื่องนี้ (ตาราง `local`) ไม่อยู่ในไฟล์สำรอง แอปส่งข้อมูลไป Anthropic เฉพาะตอนกดปุ่ม AI และทุกผลลัพธ์ต้องกดยืนยันก่อนบันทึก

## ตรวจ

```bash
npm run typecheck
npm test
npm run build
```

## โครงสร้าง

- `src/domain/` — กติกาของลูป (สร้าง, ติ๊กขั้น, เปลี่ยนสถานะ, เลื่อน, ยกข้ามวัน), เวลาว่างของวัน (`capacity.ts`) และวันที่ เป็นฟังก์ชันล้วน มี test
- `src/db.ts` — Dexie/IndexedDB (v3: loops, days, settings และ local สำหรับค่าที่อยู่เฉพาะเครื่อง เช่น API key)
- `src/domain/nudges.ts` — กติกาการเตือน (เลยกำหนด, ต้องเริ่มวันนี้, ตามงาน, ลูปนิ่ง), ข้อความตามงาน และเวลาแจ้งเตือน
- `src/domain/backup.ts` — รูปแบบไฟล์สำรอง ตรวจไฟล์ก่อนนำเข้า รวม/แทนที่ และการเตือนให้สำรอง (หน้า `#data`)
- `src/domain/rituals.ts` — การตัดสินใจตอนปิดวัน (`#shutdown`) และทบทวนสัปดาห์ (`#review`)
- `src/domain/calendar.ts` — ช่วงซิงก์, แปลงช่วงไม่ว่างเป็นนาทีในเวลางานต่อวัน, กติกาซิงก์อัตโนมัติ; `src/calendarClient.ts` + `src/useCalendar.ts` — Google Identity Services และ freeBusy API
- `src/domain/ai.ts` — คำขอและการตรวจผลของผู้ช่วย AI (จดงานจากประโยค, แตกขั้น, แผนเช้า); `src/aiClient.ts` — เรียก Claude Messages API จาก browser
- `src/notifier.ts` + `public/sw-notify.js` — แจ้งเตือนบนเครื่อง (ทำงานเฉพาะตอนที่แอปเปิดอยู่ เพราะไม่มี server)
- `src/components/` — ฟอร์มจดงาน, การ์ดลูป, กล่องสิ่งที่ต้องดู, แผงวันนี้, บอร์ดสัปดาห์ (`#week`), หน้าปิดวันและทบทวนสัปดาห์, ปุ่มตัวเลือก
- `scripts/make-icons.mjs` — สร้างไอคอน PNG ของ PWA (`npm run icons`)
