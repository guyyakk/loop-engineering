// ไม่เปิดหน้าต่าง console เพิ่มตอนรันตัว release บน Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    openloops_lib::run()
}
