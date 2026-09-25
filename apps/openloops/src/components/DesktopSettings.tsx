import { useEffect, useState } from 'react'
import { QUICK_SHORTCUT_LABEL, autostartEnabled, setAutostart, shortcutReady } from '../desktop'

/** ตั้งค่าเฉพาะแอป Windows: ปุ่มลัดจดงานด่วน และเปิดพร้อม Windows */
export function DesktopSettings() {
  const [shortcut, setShortcut] = useState<boolean | null>(null)
  const [autostart, setAutostartState] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void shortcutReady().then(setShortcut)
    void autostartEnabled().then(setAutostartState)
  }, [])

  async function toggle() {
    setError(null)
    try {
      setAutostartState(await setAutostart(!autostart))
    } catch {
      setError('ตั้งค่าเปิดพร้อม Windows ไม่สำเร็จ ลองอีกครั้ง')
    }
  }

  return (
    <div className="field desktop-settings">
      <span className="field-label">แอป Windows</span>
      <p className="field-note" role="status">
        {shortcut === null
          ? 'กำลังตรวจปุ่มลัด…'
          : shortcut
            ? `กด ${QUICK_SHORTCUT_LABEL} จากโปรแกรมไหนก็ได้ เพื่อจดงานด่วน`
            : `ใช้ปุ่มลัด ${QUICK_SHORTCUT_LABEL} ไม่ได้ เพราะโปรแกรมอื่นจองไว้แล้ว ใช้เมนู "จดงานด่วน" ที่ไอคอนใน tray แทน`}
      </p>
      <div className="notify-row">
        <button type="button" className="chip" aria-pressed={!!autostart} disabled={autostart === null} onClick={() => void toggle()}>
          {autostart ? 'เปิดพร้อม Windows อยู่' : 'เปิดพร้อม Windows'}
        </button>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <p className="field-note muted">
        ปิดหน้าต่างแล้วแอปยังทำงานอยู่ที่ tray (มุมขวาล่างของจอ) เปิดพร้อม Windows จะเริ่มแบบซ่อนไว้ที่ tray คลิกขวาที่ไอคอนเพื่อออกจากแอป
      </p>
    </div>
  )
}
