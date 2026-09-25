import { useId, useState } from 'react'
import type { AiConfig } from '../domain/ai'
import { isStale } from '../domain/calendar'
import { remainingMinutes, suggestPostpone, type DayLoad, type PlannerSettings } from '../domain/capacity'
import { WEEKDAY_SHORT, formatMinutes, withDay, type DateKey } from '../domain/dates'
import { formatClock } from '../domain/nudges'
import type { Loop } from '../domain/loop'
import { Chips, type ChipOption } from './Chips'
import { Icon } from './Icon'
import { AiSettings } from './AiSettings'
import { CalendarSettings, syncedText } from './CalendarSettings'
import { NotifySettings } from './NotifySettings'
import type { CalendarControls } from '../useCalendar'

interface Props {
  load: DayLoad
  today: DateKey
  settings: PlannerSettings
  hasTodayLoops: boolean
  /** วันทำงานถัดไป ที่ปุ่มเลื่อนจะส่งงานไป */
  postponeDate: DateKey
  /** เวลาที่ปิดวันของวันนี้ ถ้าปิดแล้ว */
  shutdownAt?: string
  onMeetingChange: (minutes: number) => void
  onSettingsChange: (settings: PlannerSettings) => void
  onPostpone: (loops: Loop[]) => void
  onTestNotification: () => void
  calendar: CalendarControls
  /** undefined = กำลังโหลด */
  aiConfig: AiConfig | undefined
  onAiConfigChange: (config: AiConfig) => void
}

const minutesOf = (iso: string) => {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

const hours = (h: number[]) => h.map((x) => ({ value: x * 60, label: formatMinutes(x * 60) }))

export const MEETINGS: ChipOption<number>[] = [{ value: 0, label: 'ไม่มี' }, ...hours([0.5, 1, 1.5, 2, 3, 4])]
const WORK_HOURS: ChipOption<number>[] = hours([6, 7, 8, 9, 10])
const BUFFERS: ChipOption<number>[] = [{ value: 0, label: 'ไม่เผื่อ' }, ...hours([0.5, 1, 1.5, 2])]
/** เรียงจันทร์ก่อน ตามสัปดาห์ทำงาน */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

function message(load: DayLoad, hasTodayLoops: boolean): string {
  switch (load.tone) {
    case 'over':
      return `วางงานเกินเวลาว่าง ${formatMinutes(-load.diffMinutes)}`
    case 'tight':
      return load.diffMinutes === 0 ? 'พอดีเวลาว่าง ไม่เหลือเผื่อเลย' : `เกือบเต็มแล้ว เหลือเวลาว่างอีก ${formatMinutes(load.diffMinutes)}`
    case 'ok':
      return `ทำทันในเวลาว่าง เหลือเผื่ออีก ${formatMinutes(load.diffMinutes)}`
    case 'empty':
      return hasTodayLoops ? 'ยังไม่มีงานที่ประเมินเวลาไว้ในวันนี้' : 'ยังไม่มีงานในวันนี้ ดึงงานจากสัปดาห์นี้มาได้'
    case 'off':
      return load.plannedMinutes > 0
        ? `วันนี้เป็นวันหยุด มีงานค้างอยู่ ${formatMinutes(load.plannedMinutes)} ไม่ต้องรีบ`
        : 'วันนี้เป็นวันหยุดตามที่ตั้งไว้'
  }
}

/** ป้ายของปุ่มธุระที่กดเอง: ถ้าวันนั้นมีข้อมูลปฏิทิน ปุ่มนี้คือธุระที่ไม่อยู่ในปฏิทิน จะได้ไม่นับซ้ำ */
export function meetingLabel(load: DayLoad): string {
  return load.calendarMinutes !== null ? 'ธุระอื่นนอกปฏิทิน' : 'ประชุมหรือธุระ'
}

/** แถบเวลาของวัน: ปฏิทิน, ธุระ, เผื่อ, งานที่วาง และส่วนที่เกินเวลาเลิกงาน */
export function CapacityBar({ load, label, compact = false }: { load: DayLoad; label: string; compact?: boolean }) {
  // วันหยุดไม่มีคำว่าเกิน งานที่วางไว้แสดงเป็นแถบปกติ
  const off = load.tone === 'off'
  const within = off ? load.plannedMinutes : Math.min(load.plannedMinutes, load.freeMinutes)
  const over = off ? 0 : Math.max(0, load.plannedMinutes - load.freeMinutes)
  const calendar = load.calendarMinutes ?? 0
  const scale = Math.max(load.workMinutes, calendar + load.meetingMinutes + load.bufferMinutes + load.plannedMinutes, 1)
  const pct = (m: number) => `${(m / scale) * 100}%`
  return (
    <div className="cap" role="img" aria-label={label}>
      <div className="cap-track">
        <span className="seg seg-calendar" style={{ width: pct(calendar) }} />
        <span className="seg seg-meeting" style={{ width: pct(load.meetingMinutes) }} />
        <span className="seg seg-buffer" style={{ width: pct(load.bufferMinutes) }} />
        <span className="seg seg-planned" style={{ width: pct(within) }} />
        <span className="seg seg-free" style={{ width: pct(Math.max(0, load.freeMinutes - within)) }} />
        {over > 0 && <span className="seg seg-over" style={{ width: pct(over) }} />}
      </div>
      {over > 0 && <span className="cap-end" style={{ left: pct(load.workMinutes) }} title="เวลาเลิกงาน" />}
      {!compact && (
      <div className="cap-legend" aria-hidden="true">
        {calendar > 0 && (
          <span>
            <i className="dot seg-calendar" /> ปฏิทิน {formatMinutes(calendar)}
          </span>
        )}
        {load.meetingMinutes > 0 && (
          <span>
            <i className="dot seg-meeting" /> {load.calendarMinutes !== null ? 'ธุระอื่น' : 'ประชุม'} {formatMinutes(load.meetingMinutes)}
          </span>
        )}
        {load.bufferMinutes > 0 && (
          <span>
            <i className="dot seg-buffer" /> เผื่อ {formatMinutes(load.bufferMinutes)}
          </span>
        )}
        <span>
          <i className="dot seg-planned" /> งานที่วาง
        </span>
        {over > 0 && (
          <span>
            <i className="dot seg-over" /> เกิน
          </span>
        )}
      </div>
      )}
    </div>
  )
}

export function TodayPanel({
  load,
  today,
  settings,
  hasTodayLoops,
  postponeDate,
  shutdownAt,
  onMeetingChange,
  onSettingsChange,
  onPostpone,
  onTestNotification,
  calendar,
  aiConfig,
  onAiConfigChange,
}: Props) {
  const [showSettings, setShowSettings] = useState(false)
  const ids = useId()
  const text = message(load, hasTodayLoops)
  const suggestions = load.tone === 'over' ? suggestPostpone(load.counted, -load.diffMinutes, today) : []
  const suggestedMinutes = suggestions.reduce((sum, l) => sum + (remainingMinutes(l) ?? 0), 0)

  return (
    <section className={`today-panel tone-${load.tone}`} aria-labelledby={`${ids}-h`}>
      <div className="tp-head">
        <h2 id={`${ids}-h`}>เวลาของวันนี้</h2>
        <a className="button tp-shutdown" href="#shutdown">
          <Icon name="check" /> {shutdownAt ? `ปิดวันแล้ว ${formatClock(minutesOf(shutdownAt))}` : 'ปิดวัน'}
        </a>
        <button
          type="button"
          className="ghost"
          aria-expanded={showSettings}
          aria-controls={`${ids}-settings`}
          onClick={() => setShowSettings((v) => !v)}
        >
          <Icon name="settings" /> ตั้งเวลาและการแจ้งเตือน
        </button>
      </div>

      <div className="metrics">
        <div className="metric">
          <span className="metric-label">เวลาว่างจริง</span>
          <span className="metric-value">{formatMinutes(load.freeMinutes)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">วางงานไว้</span>
          <span className="metric-value planned">{formatMinutes(load.plannedMinutes)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">ปิดแล้ววันนี้</span>
          <span className="metric-value">{load.doneToday} งาน</span>
        </div>
      </div>

      <CapacityBar load={load} label={text} />

      <p className="tp-msg" role="status">
        <Icon name={load.tone === 'over' ? 'alert' : load.tone === 'ok' ? 'check' : 'clock'} /> {text}
      </p>

      {(load.unestimated.length > 0 || load.carriedToday > 0 || load.waiting.length > 0) && (
        <ul className="tp-notes">
          {load.unestimated.length > 0 && (
            <li>อีก {load.unestimated.length} งานยังไม่ได้ประเมินเวลา จึงยังไม่ถูกนับ เปิดการ์ดแล้วเลือกเวลาได้เลย</li>
          )}
          {load.carriedToday > 0 && <li>ยกมาจากวันก่อน {load.carriedToday} งาน</li>}
          {load.waiting.length > 0 && <li>รอคนอื่นอยู่ {load.waiting.length} งาน ไม่นับเวลา</li>}
        </ul>
      )}

      {suggestions.length > 0 && (
        <div className="suggest">
          <p className="suggest-title">
            แนะนำให้{withDay('เลื่อนไป', postponeDate, today)} ({formatMinutes(suggestedMinutes)})
            {suggestedMinutes < -load.diffMinutes && <span className="muted"> ยังไม่พอ งานที่เหลือส่งวันนี้หรือเลยกำหนดแล้ว</span>}
          </p>
          <ul>
            {suggestions.map((l) => (
              <li key={l.id}>
                <span className="suggest-name">{l.title}</span>
                <span className="muted">{formatMinutes(remainingMinutes(l) ?? 0)}</span>
                <button type="button" onClick={() => onPostpone([l])}>
                  เลื่อน
                </button>
              </li>
            ))}
          </ul>
          {suggestions.length > 1 && (
            <button type="button" className="primary" onClick={() => onPostpone(suggestions)}>
              เลื่อนทั้ง {suggestions.length} งาน
            </button>
          )}
        </div>
      )}

      <div className="field">
        <span className="field-label">{meetingLabel(load)}วันนี้</span>
        <Chips label={`${meetingLabel(load)}วันนี้`} options={MEETINGS} value={load.meetingMinutes} onChange={onMeetingChange} />
        {settings.calendarEnabled && (
          <p className="field-note">
            Google Calendar:{' '}
            {calendar.syncing
              ? 'กำลังซิงก์'
              : settings.calendarSyncedAt
                ? `ซิงก์ล่าสุด ${syncedText(settings.calendarSyncedAt)}${isStale(settings.calendarSyncedAt, Date.now()) ? ' · ข้อมูลเก่าเกิน 1 วัน' : ''}`
                : 'ยังไม่ได้ซิงก์'}{' '}
            {!calendar.syncing && (
              <button type="button" className="link-btn" onClick={calendar.connect}>
                {calendar.hasToken ? 'ซิงก์ตอนนี้' : 'ซิงก์อีกครั้ง'}
              </button>
            )}
            {calendar.error && <span className="field-error"> {calendar.error}</span>}
          </p>
        )}
      </div>

      {showSettings && (
        <div className="tp-settings" id={`${ids}-settings`}>
          <div className="field">
            <span className="field-label">ชั่วโมงทำงานต่อวัน</span>
            <Chips
              label="ชั่วโมงทำงานต่อวัน"
              options={WORK_HOURS}
              value={settings.workMinutes}
              onChange={(workMinutes) => onSettingsChange({ ...settings, workMinutes })}
            />
          </div>
          <div className="field">
            <span className="field-label">วันทำงาน</span>
            <div className="chips" role="group" aria-label="วันทำงาน">
              {WEEK_ORDER.map((d) => {
                const on = settings.workdays.includes(d)
                return (
                  <button
                    key={d}
                    type="button"
                    className="chip"
                    aria-pressed={on}
                    onClick={() => {
                      // ต้องเหลือวันทำงานอย่างน้อยหนึ่งวัน
                      if (on && settings.workdays.length === 1) return
                      const workdays = on ? settings.workdays.filter((x) => x !== d) : [...settings.workdays, d].sort()
                      onSettingsChange({ ...settings, workdays })
                    }}
                  >
                    {WEEKDAY_SHORT[d]}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="field">
            <span className="field-label">
              เวลาเผื่อ <span className="muted">อีเมล งานแทรก และเรื่องไม่คาดคิด</span>
            </span>
            <Chips
              label="เวลาเผื่อ"
              options={BUFFERS}
              value={settings.bufferMinutes}
              onChange={(bufferMinutes) => onSettingsChange({ ...settings, bufferMinutes })}
            />
          </div>
          <NotifySettings settings={settings} onChange={onSettingsChange} onTest={onTestNotification} />
          <CalendarSettings settings={settings} onSettingsChange={onSettingsChange} calendar={calendar} />
          {aiConfig && <AiSettings config={aiConfig} onChange={onAiConfigChange} />}
          <a className="button data-link" href="#data">
            <Icon name="folder" /> ข้อมูลและการสำรอง
          </a>
        </div>
      )}
    </section>
  )
}
