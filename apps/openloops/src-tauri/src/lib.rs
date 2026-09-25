// แอป Windows ของ OpenLoops: หน้าเว็บเดิมทั้งหมด + tray, ปุ่มลัดจดงานด่วน และแจ้งเตือนของ Windows
// ข้อมูลงานทั้งหมดยังอยู่ใน IndexedDB ของ webview ฝั่ง Rust ไม่แตะข้อมูลงาน

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};

const MAIN: &str = "main";
const QUICK: &str = "quick";
/** เปิดพร้อม Windows: เริ่มแบบซ่อนหน้าต่างไว้ที่ tray */
const HIDDEN_FLAG: &str = "--hidden";

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// หน้าต่างจดงานด่วน: ขึ้นกลางจอ อยู่บนสุด แล้วบอกหน้าเว็บให้ focus ช่องชื่องาน
fn show_quick(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(QUICK) {
        let _ = window.center();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit_to(QUICK, "quick-capture", ());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        use tauri_plugin_global_shortcut::ShortcutState;
        builder = builder
            // ต้องลงทะเบียนก่อน plugin อื่น: เปิดแอปซ้ำให้ไปที่หน้าต่างเดิม
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                Some(vec![HIDDEN_FLAG]),
            ))
            .plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(|app, _shortcut, event| {
                        if matches!(event.state(), ShortcutState::Pressed) {
                            show_quick(app);
                        }
                    })
                    .build(),
            );
    }

    builder
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
                // โปรแกรมอื่นอาจจองปุ่มนี้ไว้แล้ว แอปยังต้องเปิดได้ หน้าตั้งค่าจะบอกผู้ใช้เอง
                let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyN);
                if let Err(err) = app.global_shortcut().register(shortcut) {
                    eprintln!("OpenLoops: register Ctrl+Alt+N failed: {err}");
                }
            }

            let open = MenuItem::with_id(app, "open", "เปิด OpenLoops", true, None::<&str>)?;
            let quick = MenuItem::with_id(app, "quick", "จดงานด่วน (Ctrl+Alt+N)", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "ออกจาก OpenLoops", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quick, &separator, &quit])?;

            let mut tray = TrayIconBuilder::with_id("openloops")
                .tooltip("OpenLoops")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quick" => show_quick(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            if !std::env::args().any(|arg| arg == HIDDEN_FLAG) {
                show_main(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // ปิดหน้าต่าง = ซ่อนไว้ที่ tray; ออกจริงจากเมนูที่ tray เท่านั้น
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            // จดงานด่วนแล้วคลิกไปที่อื่น ให้หน้าต่างหลบไป งานที่พิมพ์ค้างยังอยู่
            WindowEvent::Focused(false) if window.label() == QUICK => {
                let _ = window.hide();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running OpenLoops");
}
