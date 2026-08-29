# Task: แก้ลิงก์เสียใน README (ตัวอย่าง)

> ไฟล์นี้เป็น **ตัวอย่าง** สำหรับดูรูปแบบการกรอก ไม่ใช่งานจริง ห้ามลบ ใช้เป็นแบบอ้างอิงเวลาสร้าง task spec ใหม่

## Outcome

ผู้ใช้ที่เปิด README แล้วกดลิงก์ไปยัง docs อื่น ๆ ต้องไปถึงหน้าที่ถูกต้อง ไม่เจอ 404

## Context and scope

- In scope: ตรวจและแก้ path ของลิงก์ทุกอันใน `README.md`
- Out of scope: แก้เนื้อหาของไฟล์ปลายทางที่ลิงก์ไปถึง
- Constraints: ห้ามเปลี่ยนโครงสร้างโฟลเดอร์ที่มีอยู่

## Acceptance criteria

- [x] ทุกลิงก์ใน `README.md` ชี้ไปยังไฟล์ที่มีอยู่จริงใน repo
- [x] ไม่มีลิงก์ภายนอก (http/https) ที่ตอบ 404
- [x] รูปแบบ markdown ของลิงก์ยังอ่านง่ายเหมือนเดิม (ไม่เปลี่ยน wording)

## Validation plan

| Criterion | Evidence / command | Status | Notes |
| --- | --- | --- | --- |
| ลิงก์ภายในถูกต้อง | เปิดแต่ละไฟล์ที่ README ชี้ไปด้วย `Read` ทีละไฟล์ | Pass | ตรวจครบ 4 ลิงก์ |
| ลิงก์ภายนอกไม่ 404 | ไม่มีลิงก์ภายนอกใน README ฉบับนี้ | Not run | ไม่เข้าเงื่อนไข ข้ามได้ |
| Wording ไม่เปลี่ยน | เทียบ diff ด้วยตา | Pass | เปลี่ยนเฉพาะ path ในวงเล็บ `()` |

## Loop log

| Round | Change / finding | Validation result | Next decision |
| --- | --- | --- | --- |
| 0 | Spec approved | — | Implement |
| 1 | พบลิงก์ `docs/workflow.md` ผิด ที่จริงคือ `docs/LOOP_WORKFLOW.md` แก้ path เดียว | Pass ทุกเกณฑ์ | จบงาน |

## Human decision needed

None
