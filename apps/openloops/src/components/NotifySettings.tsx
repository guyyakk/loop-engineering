import { useState } from 'react'
import type { PlannerSettings } from '../domain/capacity'
import { formatClock } from '../domain/nudges'
import { permissionState, requestPermission, type PermissionState } from '../notifier'
import { Chips, type ChipOption } from './Chips'

interface Props {
  settings: PlannerSettings
  onChange: (settings: PlannerSettings) => void
  onTest: () => void
}

const START_TIMES: ChipOption<number>[] = [7 * 60, 7.5 * 60, 8 * 60, 8.5 * 60, 9 * 60, 9.5 * 60, 10 * 60].map((m) => ({
  value: m,
  label: formatClock(m),
}))

function statusText(permission: PermissionState, on: boolean, settings: PlannerSettings): string {
  if (permission === 'unsupported') return 'browser นี้ไม่รองรับการแจ้งเตือน'
  if (permission === 'denied') {
    return 'browser บล็อกการแจ้งเตือนของแอปนี้ไว้ กดไอคอนหน้าช่อง URL แล้วอนุญาต "การแจ้งเตือน" ก่อน'
  }
  if (!on) return 'ปิดอยู่ เปิดแล้วจะเตือนวันละไม่เกิน 2 ครั้ง เฉพาะวันทำงาน'
  if (permission !== 'granted') return 'ยังไม่ได้รับสิทธิ์แจ้งเตือน กดปุ่มอีกครั้งเพื่อขอสิทธิ์'
  const end = settings.startMinutes + settings.workMinutes
  return `เปิดอยู่ · สรุปแผนวันนี้ ${formatClock(settings.startMinutes)} · เตือนก่อนเลิกงาน ${formatClock(end - 30)}`
}

export function NotifySettings({ settings, onChange, onTest }: Props) {
  const [permission, setPermission] = useState<PermissionState>(permissionState)
  const on = settings.notify

  async function toggle() {
    if (on && permission === 'granted') {
      onChange({ ...settings, notify: false })
      return
    }
    const next = await requestPermission()
    setPermission(next)
    onChange({ ...settings, notify: next === 'granted' })
  }

  return (
    <>
      <div className="field">
        <span className="field-label">แจ้งเตือนบนเครื่อง</span>
        <div className="notify-row">
          <button
            type="button"
            className="chip"
            aria-pressed={on && permission === 'granted'}
            onClick={toggle}
            disabled={permission === 'unsupported'}
          >
            {on && permission === 'granted' ? 'เปิดอยู่' : 'เปิดแจ้งเตือน'}
          </button>
          {on && permission === 'granted' && (
            <button type="button" className="chip" onClick={onTest}>
              ทดสอบ
            </button>
          )}
        </div>
        <p className="field-note" role="status">
          {statusText(permission, on, settings)}
        </p>
        <p className="field-note muted">แอปไม่มี server จึงเตือนได้เฉพาะตอนที่เปิดแอปไว้ ย่อหน้าต่างไว้ได้</p>
      </div>
      <div className="field">
        <span className="field-label">
          เวลาเริ่มงาน <span className="muted">เลิกงาน {formatClock(settings.startMinutes + settings.workMinutes)}</span>
        </span>
        <Chips
          label="เวลาเริ่มงาน"
          options={START_TIMES}
          value={settings.startMinutes}
          onChange={(startMinutes) => onChange({ ...settings, startMinutes })}
        />
      </div>
    </>
  )
}
