import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { getMeetingMinutes } from '../db'
import { loadForDay, loopsOnDay, type PlannerSettings } from '../domain/capacity'
import { dateKeyOf, formatLongDay, formatMinutes, nextWorkday, withDay, type DateKey } from '../domain/dates'
import { isClosed, progress, toggleStep, type Loop } from '../domain/loop'
import {
  applyDecisions,
  countDecisions,
  decisionError,
  defaultShutdownDecision,
  isChronic,
  shutdownCandidates,
  type Decisions,
} from '../domain/rituals'
import { Icon } from './Icon'
import { DecisionPicker, RitualFrame } from './Ritual'
import { CapacityBar } from './TodayPanel'

export interface RitualResult {
  changed: Loop[]
  previous: Loop[]
  note: string
}

interface Props {
  loops: Loop[]
  today: DateKey
  settings: PlannerSettings
  /** ติ๊กขั้นบันทึกทันที เพราะเป็นข้อเท็จจริงว่าทำไปแล้ว */
  onLoopChange: (next: Loop) => void
  onFinish: (result: RitualResult) => void
  onCancel: () => void
}

const STEPS = ['ทบทวนงานของวันนี้', 'เตรียมวันทำงานถัดไป', 'สรุปและปิดวัน']

const SUMMARY: [string, string][] = [
  ['done', 'เสร็จ'],
  ['carry', 'ทำต่อ'],
  ['split', 'แตกย่อยแล้วทำต่อ'],
  ['tray', 'กลับกองงาน'],
  ['delegate', 'มอบหมาย'],
  ['drop', 'ทิ้ง'],
]

export function ShutdownWizard({ loops, today, settings, onLoopChange, onFinish, onCancel }: Props) {
  const nextDay = nextWorkday(today, settings.workdays)
  // เก็บรายการตอนเริ่ม งานที่ติ๊กจนเสร็จระหว่างทางจะยังอยู่ในรายการ แต่ไม่ต้องตัดสินใจ
  const [ids] = useState(() => shutdownCandidates(loops).map((l) => l.id))
  const [decisions, setDecisions] = useState<Decisions>(() =>
    Object.fromEntries(shutdownCandidates(loops).map((l) => [l.id, defaultShutdownDecision(l)])),
  )
  const [step, setStep] = useState(0)
  const [showErrors, setShowErrors] = useState(false)
  const [note, setNote] = useState('')
  const meeting = useLiveQuery(() => getMeetingMinutes(nextDay), [nextDay]) ?? 0

  const items = ids.map((id) => loops.find((l) => l.id === id)).filter((l): l is Loop => !!l)
  const open = items.filter((l) => !isClosed(l))
  const invalid = open.filter((l) => decisionError(decisions[l.id]))
  const waiting = loops.filter((l) => l.horizon === 'today' && l.status === 'waiting').length
  const ctx = { now: new Date(), nextWorkday: nextDay, workdays: settings.workdays }
  const preview = applyDecisions(loops, decisions, ctx).next
  const load = loadForDay(preview, nextDay, today, settings, meeting)
  const doneToday = loops.filter((l) => l.status === 'done' && l.closedAt && dateKeyOf(l.closedAt) === today).length
  const nextLabel = withDay('', nextDay, today).trim()

  function next() {
    if (step === 0 && invalid.length) {
      setShowErrors(true)
      document.getElementById(`decide-${invalid[0].id}`)?.querySelector<HTMLElement>('button, input')?.focus()
      return
    }
    if (step < STEPS.length - 1) {
      setStep(step + 1)
      return
    }
    const { changed, previous } = applyDecisions(loops, decisions, { ...ctx, now: new Date() })
    onFinish({ changed, previous, note: note.trim() })
  }

  const counts = countDecisions(items, decisions)

  return (
    <RitualFrame
      title="ปิดวัน"
      steps={STEPS}
      step={step}
      nextLabel={step === STEPS.length - 1 ? 'ปิดวัน' : 'ถัดไป'}
      onBack={() => setStep(step - 1)}
      onNext={next}
      onCancel={onCancel}
    >
      {step === 0 && (
        <>
          <p className="ritual-lead">ตัดสินใจกับทุกงานที่ยังเปิดอยู่ในวันนี้ งานไหนทำไปแล้วบางขั้น ติ๊กไว้ได้เลย</p>
          {items.length === 0 && <p className="ritual-empty">ไม่มีงานเปิดค้างในวันนี้แล้ว</p>}
          {items.map((loop) => {
            const { done, total } = progress(loop)
            const chronic = isChronic(loop)
            return (
              <article key={loop.id} id={`decide-${loop.id}`} className="ritual-item" data-chronic={chronic && !isClosed(loop)}>
                <div className="ri-head">
                  <span className="ri-title">{loop.title}</span>
                  {total > 0 && (
                    <span className="badge">
                      {done}/{total} ขั้น
                    </span>
                  )}
                  {loop.rolloverCount > 0 && (
                    <span className={`badge ${chronic ? 'tone-warn' : ''}`}>
                      <Icon name="repeat" size={12} /> เลื่อนมา {loop.rolloverCount} ครั้ง
                    </span>
                  )}
                </div>
                {loop.steps.length > 0 && (
                  <details className="ri-steps">
                    <summary>อัปเดตขั้นที่ทำแล้ว</summary>
                    <ul>
                      {loop.steps.map((s) => (
                        <li key={s.id}>
                          <label className={s.doneAt ? 'is-done' : undefined}>
                            <input
                              type="checkbox"
                              checked={!!s.doneAt}
                              onChange={() => onLoopChange(toggleStep(loop, s.id, new Date()))}
                            />
                            <span>{s.title}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {isClosed(loop) ? (
                  <p className="ri-closed">
                    <Icon name="check" /> เสร็จแล้ว
                  </p>
                ) : (
                  <>
                    {chronic && (
                      <p className="ri-ask">งานนี้เลื่อนมาแล้ว {loop.rolloverCount} ครั้ง ครั้งนี้จะเอาอย่างไรดี</p>
                    )}
                    <DecisionPicker
                      label={`จะทำอย่างไรกับ ${loop.title}`}
                      options={chronic ? ['carry', 'split', 'delegate', 'drop', 'done'] : ['done', 'carry', 'tray-week', 'tray-later', 'drop']}
                      labels={{ carry: chronic ? `ทำ (${nextLabel})` : withDay('ทำต่อ', nextDay, today) }}
                      value={decisions[loop.id]}
                      onChange={(d) => setDecisions({ ...decisions, [loop.id]: d })}
                      splitCarries
                      error={showErrors ? decisionError(decisions[loop.id]) : null}
                    />
                  </>
                )}
              </article>
            )
          })}
          {waiting > 0 && <p className="field-note">รอคนอื่นอยู่ {waiting} งานในวันนี้ แอปจะเตือนให้ตามตามวันที่ตั้งไว้</p>}
        </>
      )}

      {step === 1 && (
        <>
          <p className="ritual-lead">
            {formatLongDay(nextDay)} วางงานไว้ {formatMinutes(load.plannedMinutes)} จากเวลาว่าง {formatMinutes(load.freeMinutes)}
          </p>
          <CapacityBar load={load} label={`วางไว้ ${formatMinutes(load.plannedMinutes)} จาก ${formatMinutes(load.freeMinutes)}`} />
          {load.tone === 'over' && (
            <p className="field-error">
              เกินเวลาว่าง {formatMinutes(-load.diffMinutes)} ย้อนกลับไปย้ายบางงานกลับกองงานได้
            </p>
          )}
          <ul className="ritual-list">
            {loopsOnDay(preview, nextDay, today).map((l) => (
              <li key={l.id}>{l.title}</li>
            ))}
            {loopsOnDay(preview, nextDay, today).length === 0 && <li className="muted">ยังไม่มีงานในวันนั้น</li>}
          </ul>
        </>
      )}

      {step === 2 && (
        <>
          <p className="ritual-lead">วันนี้ปิดงานไปแล้ว {doneToday} งาน</p>
          <ul className="ritual-counts">
            {SUMMARY.filter(([k]) => counts[k as keyof typeof counts]).map(([k, label]) => (
              <li key={k}>
                <strong>{counts[k as keyof typeof counts]}</strong> {label}
              </li>
            ))}
          </ul>
          <div className="field">
            <label className="field-label" htmlFor="shutdown-note">
              โน้ตสั้น ๆ ก่อนเลิกงาน <span className="muted">ไม่บังคับ</span>
            </label>
            <textarea
              id="shutdown-note"
              rows={3}
              placeholder="พรุ่งนี้เริ่มจากโทรหาลูกค้า ABC ก่อน"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </>
      )}
    </RitualFrame>
  )
}
