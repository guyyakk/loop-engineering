# Task: OpenLoops 9 — แอป Windows: ไอคอนที่ tray, ปุ่มลัดจดงานด่วน, แจ้งเตือนของ Windows

> spec ย่อยที่ 9 ของ [2026-09-24-openloops-0-epic.md](2026-09-24-openloops-0-epic.md) (v3) ต่อยอดจาก [spec 8](2026-09-25-openloops-8-ai-assist.md)

## Outcome

OpenLoops อยู่บน Windows เป็นแอปจริง: ปิดหน้าต่างแล้วยังอยู่ที่ tray, กด Ctrl+Alt+N จากโปรแกรมไหนก็ได้แล้วมีหน้าต่างจดงานเล็ก ๆ ขึ้นมาทันที, สรุปเช้าและเตือนปิดวันเด้งเป็นแจ้งเตือนของ Windows แม้ไม่ได้เปิดหน้าต่างไว้ และเลือกให้เปิดพร้อม Windows ได้ เว็บ/PWA เดิมยังทำงานเหมือนเดิม

## Context and scope

- In scope:
  - โปรเจกต์ Tauri 2 ที่ `apps/openloops/src-tauri` ใช้หน้าเว็บเดิมทั้งหมด; คำสั่ง `npm run desktop:dev` และ `npm run desktop:build` (ได้ตัวติดตั้ง NSIS `.exe`)
  - tray: คลิกซ้ายเปิดหน้าต่างหลัก, เมนู "เปิด OpenLoops / จดงานด่วน / ออก"; ปิดหน้าต่าง = ซ่อนไว้ที่ tray; เปิดแอปซ้ำ = ไปที่หน้าต่างเดิม (single instance)
  - ปุ่มลัดทั้งระบบ Ctrl+Alt+N → หน้าต่างจดงานด่วน (ฟอร์มเดิม รวมปุ่ม AI ถ้ามี key) กด Enter บันทึกแล้วหน้าต่างหายไป, Esc ปิด
  - แจ้งเตือนสรุปเช้า/เตือนปิดวันผ่านแจ้งเตือนของ Windows (plugin notification) แทน service worker
  - ส่วน "แอป Windows" ในการตั้งค่า (แสดงเฉพาะในแอป desktop): สถานะปุ่มลัด, สวิตช์เปิดพร้อม Windows (เปิดแบบซ่อนไว้ที่ tray)
  - ในแอป desktop ไม่ลงทะเบียน service worker
- Out of scope: แจ้งเตือนผ่าน LINE (ผู้ใช้เลือกใช้แจ้งเตือนของ Windows แทน เพราะ LINE Notify ปิดบริการแล้ว), เปลี่ยนปุ่มลัดเอง, อัปเดตแอปอัตโนมัติ, macOS/Linux, sync ข้อมูลระหว่าง browser กับแอป (ใช้ไฟล์สำรองย้ายข้อมูล), เซ็นรับรองตัวติดตั้ง
- Constraints:
  - ข้อมูลของแอป desktop อยู่ใน WebView2 ของแอปเอง แยกจาก Chrome/Edge — ย้ายด้วยไฟล์สำรอง (spec 6) และบอกผู้ใช้ในหน้าจอเริ่มต้น
  - ต้องมี Rust (MSVC) + Visual Studio Build Tools (C++) + WebView2 ในเครื่องที่ build; ติดตั้งเครื่องมือระดับระบบเฉพาะเมื่อผู้ใช้สั่ง และต้องผ่าน UAC ของ Windows
  - AI มองเห็นหน้าต่าง/tray/แจ้งเตือนของ Windows ไม่ได้ ส่วนนั้นผู้ใช้ต้องทดสอบ

## กติกา

- ตรวจว่าอยู่ในแอป desktop ด้วย `isTauri()`; โค้ดเฉพาะ desktop เรียกได้เฉพาะเมื่อเป็น desktop เท่านั้น
- หน้าต่าง `quick` แสดงเฉพาะฟอร์มจดงาน (ทำเมื่อไหร่ = สัปดาห์นี้ เหมือนกด N), เปิดทุกครั้งเริ่มฟอร์มใหม่และ focus ช่องชื่องาน; หน้าต่างหลักเห็นงานใหม่ทันทีโดยไม่ต้องรีโหลด
- หน้าต่าง `quick` ไม่ยกงานข้ามวัน ไม่ส่งแจ้งเตือน ไม่ซิงก์ปฏิทิน (หน้าที่ของหน้าต่างหลักเท่านั้น)
- ปุ่มลัดถูกโปรแกรมอื่นจองไว้ → แอปยังเปิดได้ และส่วนตั้งค่าบอกว่าใช้ปุ่มลัดไม่ได้ ให้ใช้เมนูที่ tray แทน
- เปิดพร้อม Windows ส่ง `--hidden` แอปเริ่มแบบซ่อนหน้าต่างไว้ที่ tray

## Acceptance criteria

- [x] AC1 `src-tauri` build ได้ (`cargo check` / `npm run desktop:build`) ได้ตัวติดตั้ง `.exe`; เปิดแล้วแสดงหน้าเดิม ข้อมูลใช้งานได้ปกติ
- [ ] AC2 tray + ปิดหน้าต่างแล้วซ่อน + เมนู เปิด/จดงานด่วน/ออก + เปิดซ้ำไปหน้าต่างเดิม
- [ ] AC3 Ctrl+Alt+N เปิดหน้าต่างจดงานด่วนจากทุกโปรแกรม บันทึกแล้วหน้าต่างหลักเห็นงานใหม่ทันที; Esc ปิด
- [ ] AC4 สรุปเช้า/เตือนปิดวัน/ปุ่มทดสอบ เป็นแจ้งเตือนของ Windows แม้หน้าต่างถูกซ่อน
- [ ] AC5 ส่วนแอป Windows ในการตั้งค่า: สถานะปุ่มลัด, เปิดพร้อม Windows (เริ่มแบบซ่อน); ข้อความย้ายข้อมูลจาก browser ในหน้าจอเริ่มต้น
- [x] AC6 เว็บ/PWA เดิมไม่เปลี่ยน: typecheck/test/build ผ่าน, ไม่มีส่วน desktop ใน browser, 375px ไม่มี scroll แนวนอน

## Validation plan

| Criterion | Evidence / command | Status | Notes |
| --- | --- | --- | --- |
| AC1 | `cargo check` + `npm run desktop:build` + เปิด `openloops.exe` ที่ build ได้ | Pass | ติดตั้ง Build Tools 2022 (MSVC 14.44, Windows SDK 10.0.26100) และ Rust stable-msvc ตามคำสั่งผู้ใช้; `cargo check` ผ่านไม่มี warning (1m 46s); release build 2m 45s ได้ `OpenLoops_0.1.0_x64-setup.exe` 2.2 MB, ตัวแอป 9.4 MB; `dist-desktop` ไม่มี `sw.js`; เปิดแล้วมีหน้าต่าง "OpenLoops" แสดงและ "จดงานด่วน · OpenLoops" ซ่อนอยู่ — **ยังไม่ได้รันตัวติดตั้ง** (จะติดตั้งโปรแกรมลงเครื่องผู้ใช้) |
| AC2 | smoke test ด้วย PowerShell + Win32 API (EnumWindows, WM_CLOSE) บน exe จริง | Partial | เปิดซ้ำ: process ที่สองออกเองใน 4 วินาที เหลือ 1 process; ส่ง WM_CLOSE ให้หน้าต่างหลัก → process ยังอยู่ หน้าต่างเปลี่ยนเป็น hidden; **ไอคอนและเมนูที่ tray: Not run** — AI มองไม่เห็น tray |
| AC3 | `QuickApp.test.tsx` (Enter บันทึกลง IndexedDB + ซ่อนหน้าต่าง + ฟอร์มใหม่, Esc ซ่อนโดยไม่บันทึก, เปิดอีกครั้ง focus ช่องชื่องาน) + browser pane จำลอง `__TAURI_INTERNALS__` ป้ายหน้าต่าง `quick` ที่ 480×640 | Partial | หน้าเว็บ: แสดงแค่ฟอร์ม focus ช่องชื่องาน, บันทึกแล้วเรียก `plugin:window\|hide` และงานอยู่ใน IndexedDB, Esc เรียก hide; exe จริง: ลอง `RegisterHotKey` Ctrl+Alt+N ซ้ำไม่สำเร็จ (แอปจองไว้แล้ว) และส่ง Ctrl+Alt+N แล้วหน้าต่าง "จดงานด่วน" เปลี่ยนจาก hidden เป็น visible; **พิมพ์บันทึกในหน้าต่างจริงแล้วหน้าต่างหลักเห็นงานใหม่ทันที: Not run** |
| AC4 | `notifier.test.ts` (ในแอป desktop ใช้ `desktopNotify` ไม่ขอสิทธิ์ browser, นอกแอปใช้ทางเดิม) + browser pane จำลอง | Partial | ปุ่มทดสอบส่ง "แผนวันนี้ · OpenLoops" ผ่าน `sendNotification` ของ plugin และข้อความในการตั้งค่าเปลี่ยนเป็นเรื่อง tray; **แจ้งเตือนจริงตอนหน้าต่างถูกซ่อน: Not run** |
| AC5 | `DesktopSettings.test.tsx` (ปุ่มลัดใช้ได้/ถูกจอง, เปิดพร้อม Windows, error) + browser pane จำลอง | Partial | เรียก `is_registered` ด้วย `Control+Alt+N`, `is_enabled`, `enable` ถูกคำสั่ง; ข้อความย้ายข้อมูลในหน้าจอเริ่มต้นแสดงเฉพาะในแอป desktop; exe จริงเปิดด้วย `--hidden` แล้วหน้าต่างหลักเป็น hidden; **สวิตช์เปิดพร้อม Windows ในแอปจริง: Not run** |
| AC6 | `npm run typecheck && npm test && npm run build` + browser pane | Pass | 16 files / 139 tests; `dist` ยังมี `sw.js` และลงทะเบียน service worker; ใน browser ไม่มีส่วน "แอป Windows" และไม่มีข้อความย้ายข้อมูล; 375px `scrollWidth` = 375 ทั้งสว่างและมืด; ไม่มี console error |
| Lint | — | Not run | ยังไม่ได้ตั้ง ESLint |

## Loop log

| Round | Change / finding | Validation result | Next decision |
| --- | --- | --- | --- |
| 0 | ผู้ใช้เลือก Tauri และแจ้งเตือนของ Windows แทน LINE (2026-09-25); เครื่องยังไม่มี Rust / Build Tools / Windows SDK | — | Implement ส่วนที่ไม่ต้อง compile ก่อน แล้วขอให้ผู้ใช้ติดตั้งเครื่องมือ |
| 1 | `src-tauri` (Cargo.toml, lib.rs: tray, ปุ่มลัด, single instance, autostart `--hidden`, ปิด = ซ่อน, หน้าต่าง quick หลบเมื่อเสีย focus; tauri.conf.json; capabilities; ไอคอนจาก `tauri icon`), `desktop.ts`, `QuickApp.tsx`, `DesktopSettings.tsx`, notifier ผ่าน plugin, `build:desktop` ปิด PWA | typecheck ผ่าน, 139 tests ผ่าน, build เว็บและ build:desktop ผ่าน; browser pane ผ่าน AC6 และส่วนหน้าเว็บของ AC3–AC5; **Rust ยังไม่ได้ compile** | Blocked: รอผู้ใช้ติดตั้ง Rust + Build Tools แล้ว `cargo check` / `desktop:build` |
| — | ผู้ใช้สั่งให้ติดตั้ง Rust + Build Tools (winget ผ่าน UAC ของ Windows); ไม่มีการแก้โค้ด จึงไม่นับเป็นรอบแก้ | `cargo check` ผ่านรอบแรก ไม่มี warning; `desktop:build` ได้ตัวติดตั้ง; smoke test exe จริงผ่าน (single instance, ปิด = ซ่อน, Ctrl+Alt+N, `--hidden`) | จบงาน — tray, แจ้งเตือนจริง และตัวติดตั้งรอผู้ใช้ทดสอบ |

## Remaining risk

- แจ้งเตือนตอนหน้าต่างหลักถูกซ่อนพึ่งตัวจับเวลา JavaScript ใน WebView2 ที่ซ่อนอยู่ ถ้า Windows/WebView2 พักหน้าที่ซ่อนไว้นานเกินไป การแจ้งเตือนอาจช้า ต้องยืนยันบนเครื่องจริง
- แจ้งเตือนของ Windows ใน `desktop:dev` จะแสดงชื่อ PowerShell แทน OpenLoops (ต้องติดตั้งจากตัวติดตั้งถึงจะแสดงชื่อแอป) และกดที่แจ้งเตือนแล้วยังไม่เปิดหน้าที่เกี่ยวข้อง
- Google Calendar ในแอป Windows น่าจะใช้ไม่ได้: origin ของแอปคือ `http://tauri.localhost` และหน้าต่าง popup ของ Google ใน WebView2 ยังไม่ได้ทดสอบ (ในเว็บยังใช้ได้ตามเดิม)
- ตัวติดตั้งยังไม่เซ็นรับรอง Windows SmartScreen จะเตือนตอนติดตั้งครั้งแรก

## Human decision needed

1. ~~ติดตั้งเครื่องมือ build~~ ติดตั้งแล้ว 2026-09-25 (Build Tools 2022 + Rust stable-msvc)
2. ทดสอบบน Windows จริง: ติดตั้งจาก `src-tauri/target/release/bundle/nsis/OpenLoops_0.1.0_x64-setup.exe` → ดูไอคอนและเมนูที่ tray, กด Ctrl+Alt+N แล้วจดงาน, ปุ่มทดสอบแจ้งเตือน (ชื่อแอปต้องขึ้นเป็น OpenLoops), สวิตช์เปิดพร้อม Windows แล้วรีสตาร์ตเครื่อง
3. ย้ายข้อมูลจาก browser: ส่งออกไฟล์สำรองจาก Chrome/Edge แล้วนำเข้าในแอป
