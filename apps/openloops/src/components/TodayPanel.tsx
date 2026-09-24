import { useId, useState } from 'react'
import { remainingMinutes, suggestPostpone, type DayLoad, type PlannerSettings } from '../domain/capacity'
import { formatMinutes, type DateKey } from '../domain/dates'
import type { Loop } from '../domain/loop'
import { Chips, type ChipOption } from './Chips'
import { Icon } from './Icon'

interface Props {
  load: DayLoad
  today: DateKey
  settings: PlannerSettings
  hasTodayLoops: boolean
  onMeetingChange: (minutes: number) => void
  onSettingsChange: (settings: PlannerSettings) => void
  onPostpone: (loops: Loop[]) => void
}

const hours = (h: number[]) => h.map((x) => ({ value: x * 60, label: formatMinutes(x * 60) }))

const MEETINGS: ChipOption<number>[] = [{ value: 0, label: 'ไม่มี' }, ...hours([0.5, 1, 1.5, 2, 3, 4])]
const WORKDAYS: ChipOption<number>[] = hours([6, 7, 8, 9, 10])
const BUFFERS: ChipOption<number>[] = [{ value: 0, label: 'ไม่เผื่อ' }, ...hours([0.5, 1, 1.5, 2])]

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
  }
}

/** แถบเวลาของวัน: ประชุม, เผื่อ, งานที่วาง และส่วนที่เกินเวลาเลิกงาน */
function CapacityBar({ load, label }: { load: DayLoad; label: string }) {
  const within = Math.min(load.plannedMinutes, load.freeMinutes)
  const over = Math.max(0, load.plannedMinutes - load.freeMinutes)
  const scale = Math.max(load.workMinutes, load.meetingMinutes + load.bufferMinutes + load.plannedMinutes, 1)
  const pct = (m: number) => `${(m / scale) * 100}%`
  return (
    <div className="cap" role="img" aria-label={label}>
      <div className="cap-track">
        <span className="seg seg-meeting" style={{ width: pct(load.meetingMinutes) }} />
        <span className="seg seg-buffer" style={{ width: pct(load.bufferMinutes) }} />
        <span className="seg seg-planned" style={{ width: pct(within) }} />
        <span className="seg seg-free" style={{ width: pct(load.freeMinutes - within) }} />
        {over > 0 && <span className="seg seg-over" style={{ width: pct(over) }} />}
      </div>
      {over > 0 && <span className="cap-end" style={{ left: pct(load.workMinutes) }} title="เวลาเลิกงาน" />}
      <div className="cap-legend" aria-hidden="true">
        {load.meetingMinutes > 0 && (
          <span>
            <i className="dot seg-meeting" /> ประชุม {formatMinutes(load.meetingMinutes)}
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
    </div>
  )
}

export function TodayPanel({ load, today, settings, hasTodayLoops, onMeetingChange, onSettingsChange, onPostpone }: Props) {
  const [showSettings, setShowSettings] = useState(false)
  const ids = useId()
  const text = message(load, hasTodayLoops)
  const suggestions = load.tone === 'over' ? suggestPostpone(load.counted, -load.diffMinutes, today) : []
  const suggestedMinutes = suggestions.reduce((sum, l) => sum + (remainingMinutes(l) ?? 0), 0)

  return (
    <section className={`today-panel tone-${load.tone}`} aria-labelledby={`${ids}-h`}>
      <div className="tp-head">
        <h2 id={`${ids}-h`}>เวลาของวันนี้</h2>
        <button
          type="button"
          className="ghost"
          aria-expanded={showSettings}
          aria-controls={`${ids}-settings`}
          onClick={() => setShowSettings((v) => !v)}
        >
          <Icon name="settings" /> ตั้งเวลาทำงาน
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
          {load.carriedToday > 0 && <li>ยกมาจากเมื่อวาน {load.carriedToday} งาน</li>}
          {load.waiting.length > 0 && <li>รอคนอื่นอยู่ {load.waiting.length} งาน ไม่นับเวลา</li>}
        </ul>
      )}

      {suggestions.length > 0 && (
        <div className="suggest">
          <p className="suggest-title">
            แนะนำให้เลื่อนไปพรุ่งนี้ ({formatMinutes(suggestedMinutes)})
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
        <span className="field-label">ประชุมหรือธุระวันนี้</span>
        <Chips label="ประชุมหรือธุระวันนี้" options={MEETINGS} value={load.meetingMinutes} onChange={onMeetingChange} />
      </div>

      {showSettings && (
        <div className="tp-settings" id={`${ids}-settings`}>
          <div className="field">
            <span className="field-label">ชั่วโมงทำงานต่อวัน</span>
            <Chips
              label="ชั่วโมงทำงานต่อวัน"
              options={WORKDAYS}
              value={settings.workMinutes}
              onChange={(workMinutes) => onSettingsChange({ ...settings, workMinutes })}
            />
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
        </div>
      )}
    </section>
  )
}
