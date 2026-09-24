import { useId, useState } from 'react'
import { isStale, validateClientId } from '../domain/calendar'
import type { PlannerSettings } from '../domain/capacity'
import { formatClock } from '../domain/nudges'
import type { CalendarControls } from '../useCalendar'

interface Props {
  settings: PlannerSettings
  onSettingsChange: (settings: PlannerSettings) => void
  calendar: CalendarControls
}

export function syncedText(iso: string): string {
  const d = new Date(iso)
  const time = formatClock(d.getHours() * 60 + d.getMinutes())
  const sameDay = new Date().toDateString() === d.toDateString()
  return sameDay ? `วันนี้ ${time}` : `${d.getDate()}/${d.getMonth() + 1} ${time}`
}

const CONSOLE = 'https://console.cloud.google.com'

/** ตั้งค่าและเชื่อม Google Calendar แบบเห็นแค่ช่วงไม่ว่าง */
export function CalendarSettings({ settings, onSettingsChange, calendar }: Props) {
  const ids = useId()
  const [editing, setEditing] = useState(!settings.googleClientId)
  const [draft, setDraft] = useState(settings.googleClientId ?? '')
  const [draftError, setDraftError] = useState<string | null>(null)
  const enabled = settings.calendarEnabled
  const stale = isStale(settings.calendarSyncedAt, Date.now())

  function saveClientId() {
    const error = validateClientId(draft)
    setDraftError(error)
    if (error) return
    onSettingsChange({ ...settings, googleClientId: draft.trim() })
    setEditing(false)
  }

  const status = !settings.googleClientId
    ? 'ยังไม่ได้ตั้งค่า ใส่ Client ID ของคุณก่อน แอปไม่มี server จึงต้องใช้ Client ID ของคุณเอง'
    : enabled && settings.calendarSyncedAt
      ? `เชื่อมแล้ว · ซิงก์ล่าสุด ${syncedText(settings.calendarSyncedAt)}${stale ? ' · ข้อมูลเก่าเกิน 1 วัน' : ''}`
      : 'พร้อมเชื่อมต่อ กดแล้ว Google จะถามสิทธิ์ดูช่วงเวลาว่างของปฏิทินเท่านั้น'

  return (
    <div className="field calendar-settings">
      <span className="field-label">
        Google Calendar <span className="muted">ดึงช่วงไม่ว่างมาคิดเวลาว่าง แอปไม่เห็นชื่อหรือรายละเอียดนัด</span>
      </span>
      <p className="field-note" role="status">
        {calendar.syncing ? 'กำลังซิงก์กับ Google Calendar' : status}
      </p>
      {calendar.error && (
        <p className="field-error" role="alert">
          {calendar.error}
        </p>
      )}

      {editing ? (
        <>
          <div className="inline-add">
            <label className="sr-only" htmlFor={`${ids}-client`}>
              OAuth Client ID
            </label>
            <input
              id={`${ids}-client`}
              placeholder="1234567890-abc123.apps.googleusercontent.com"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                setDraftError(null)
              }}
              aria-invalid={!!draftError}
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" onClick={saveClientId}>
              บันทึก
            </button>
          </div>
          {draftError && (
            <p className="field-error" role="alert">
              {draftError}
            </p>
          )}
          <details className="setup-guide">
            <summary>วิธีสร้าง Client ID (ทำครั้งเดียว ราว 5 นาที)</summary>
            <ol>
              <li>
                <a href={`${CONSOLE}/projectcreate`} target="_blank" rel="noopener noreferrer">
                  สร้างโปรเจกต์ใหม่
                </a>{' '}
                ใน Google Cloud Console ตั้งชื่ออะไรก็ได้ เช่น OpenLoops
              </li>
              <li>
                <a href={`${CONSOLE}/apis/library/calendar-json.googleapis.com`} target="_blank" rel="noopener noreferrer">
                  เปิดใช้ Google Calendar API
                </a>{' '}
                ในโปรเจกต์นั้น
              </li>
              <li>
                <a href={`${CONSOLE}/apis/credentials/consent`} target="_blank" rel="noopener noreferrer">
                  ตั้งค่าหน้าขอสิทธิ์ (OAuth consent screen)
                </a>{' '}
                เลือก External แล้วเพิ่มอีเมลของคุณเป็น Test user
              </li>
              <li>
                <a href={`${CONSOLE}/apis/credentials`} target="_blank" rel="noopener noreferrer">
                  สร้าง Credentials
                </a>{' '}
                → OAuth client ID → Web application → ใน Authorized JavaScript origins ใส่ <code>{window.location.origin}</code>
              </li>
              <li>คัดลอก Client ID มาวางในช่องด้านบน แล้วกดบันทึก</li>
            </ol>
          </details>
        </>
      ) : (
        <div className="notify-row">
          <button type="button" className="chip" aria-pressed={enabled} onClick={calendar.connect}>
            {calendar.syncing ? 'กำลังซิงก์…' : enabled ? (calendar.hasToken ? 'ซิงก์ตอนนี้' : 'ซิงก์อีกครั้ง') : 'เชื่อมต่อ Google Calendar'}
          </button>
          {enabled && (
            <button type="button" className="chip" onClick={() => void calendar.disconnect()}>
              ตัดการเชื่อมต่อ
            </button>
          )}
          <button type="button" className="chip" onClick={() => setEditing(true)}>
            เปลี่ยน Client ID
          </button>
        </div>
      )}
    </div>
  )
}
