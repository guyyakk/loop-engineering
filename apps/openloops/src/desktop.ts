import { isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { isRegistered } from '@tauri-apps/plugin-global-shortcut'
import { sendNotification } from '@tauri-apps/plugin-notification'

// ส่วนที่ใช้เฉพาะในแอป Windows (Tauri) ทุกฟังก์ชันต้องเรียกหลังเช็ก isDesktop() แล้วเท่านั้น

/** ปุ่มลัดที่ฝั่ง Rust ลงทะเบียนไว้ (src-tauri/src/lib.rs) */
export const QUICK_SHORTCUT = 'Control+Alt+N'
export const QUICK_SHORTCUT_LABEL = 'Ctrl+Alt+N'
export const QUICK_WINDOW = 'quick'

export function isDesktop(): boolean {
  return isTauri()
}

/** ชื่อหน้าต่างปัจจุบัน ใน browser เป็น null */
export function windowLabel(): string | null {
  return isDesktop() ? getCurrentWindow().label : null
}

export async function hideWindow(): Promise<void> {
  await getCurrentWindow().hide()
}

/** ฝั่ง Rust ส่ง event นี้ทุกครั้งที่เปิดหน้าต่างจดงานด่วน คืนฟังก์ชันเลิกฟัง */
export function onQuickCapture(handler: () => void): () => void {
  let stop: (() => void) | null = null
  let stopped = false
  void listen('quick-capture', handler).then((unlisten) => {
    if (stopped) unlisten()
    else stop = unlisten
  })
  return () => {
    stopped = true
    stop?.()
  }
}

/** แจ้งเตือนของ Windows ขึ้นได้แม้หน้าต่างถูกซ่อนไว้ที่ tray */
export function desktopNotify(title: string, body: string): void {
  sendNotification({ title, body })
}

export async function shortcutReady(): Promise<boolean> {
  try {
    return await isRegistered(QUICK_SHORTCUT)
  } catch {
    return false
  }
}

export async function autostartEnabled(): Promise<boolean> {
  try {
    return await isEnabled()
  } catch {
    return false
  }
}

export async function setAutostart(on: boolean): Promise<boolean> {
  await (on ? enable() : disable())
  return autostartEnabled()
}
