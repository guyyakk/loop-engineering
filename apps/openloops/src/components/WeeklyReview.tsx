import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { getBusyRange } from '../db'
import { buildWeek, type PlannerSettings } from '../domain/capacity'
import {
  addDays,
  dateKeyOf,
  formatMinutes,
  formatShortDay,
  formatWeekRange,
  nextWorkday,
  startOfWeek,
  withDay,
  type DateKey,
} from '../domain/dates'
import { HORIZON_LABEL, type Loop } from '../domain/loop'
import {
  applyDecisions,
  countDecisions,
  defaultTargetWeek,
  plannableDays,
  planCandidates,
  reviewCandidates,
  weekSummary,
  type Decisions,
} from '../domain/rituals'
import { Chips } from './Chips'
import { DecisionPicker, RitualFrame } from './Ritual'
import type { RitualResult } from './ShutdownWizard'
import { CapacityBar } from './TodayPanel'

interface Props {
  loops: Loop[]
  today: DateKey
  settings: PlannerSettings
  shutdownDates: DateKey[]
  onFinish: (result: RitualResult) => void
  onCancel: () => void
  onBackup: () => void
  lastBackupAt: string | null
}

const STEPS = ['สรุปสัปดาห์นี้', 'เคลียร์งานค้าง', 'วางแผนสัปดาห์', 'สรุปและบันทึก']
const FIRST_DONE = 8

export function WeeklyReview({ loops, today, settings, shutdownDates, onFinish, onCancel, onBackup, lastBackupAt }: Props) {
  const [step, setStep] = useState(0)
  // เก็บรายการงานค้างตอนเริ่ม ตัดสินใจแล้วรายการจะได้ไม่ขยับไปมา
  const [review] = useState(() => reviewCandidates(loops, today, settings))
  const [clear, setClear] = useState<Decisions>(() => Object.fromEntries(review.map((r) => [r.loop.id, { kind: 'keep' }])))
  const [plan, setPlan] = useState<Decisions>({})
  const [targetWeek, setTargetWeek] = useState(() => defaultTargetWeek(today))
  const meetings = useLiveQuery(() => getBusyRange(targetWeek, addDays(targetWeek, 6)), [targetWeek])

  const summary = weekSummary(loops, today, settings, shutdownDates)
  const handled = new Set(review.filter((r) => clear[r.loop.id]?.kind !== 'keep').map((r) => r.loop.id))
  const candidates = planCandidates(loops, handled)
  const decisions: Decisions = { ...clear, ...plan }
  const ctx = { now: new Date(), nextWorkday: nextWorkday(today, settings.workdays), workdays: settings.workdays }
  const preview = applyDecisions(loops, decisions, ctx).next
  const week = buildWeek(preview, targetWeek, today, settings, meetings ?? {})
  const dayOptions = plannableDays(targetWeek, today, settings).map((date) => ({ date, label: formatShortDay(date) }))
  const thisWeek = startOfWeek(today)
  const counts = countDecisions(loops, decisions)

  function next() {
    if (step < STEPS.length - 1) {
      setStep(step + 1)
      return
    }
    const { changed, previous } = applyDecisions(loops, decisions, { ...ctx, now: new Date() })
    onFinish({ changed, previous, note: '' })
  }

  function switchWeek(start: DateKey) {
    // วันที่เลือกไว้ของอีกสัปดาห์ใช้ไม่ได้แล้ว ล้างเฉพาะการเลือกวัน
    setPlan(Object.fromEntries(Object.entries(plan).filter(([, d]) => d?.kind !== 'schedule')))
    setTargetWeek(start)
  }

  return (
    <RitualFrame
      title="ทบทวนสัปดาห์"
      steps={STEPS}
      step={step}
      nextLabel={step === STEPS.length - 1 ? 'บันทึกการทบทวน' : 'ถัดไป'}
      onBack={() => setStep(step - 1)}
      onNext={next}
      onCancel={onCancel}
    >
      {step === 0 && (
        <>
          <div className="metrics">
            <div className="metric">
              <span className="metric-label">ปิดงานไป</span>
              <span className="metric-value">{summary.done.length} งาน</span>
            </div>
            <div className="metric">
              <span className="metric-label">เวลางานที่เสร็จ</span>
              <span className="metric-value">{formatMinutes(summary.doneMinutes)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">ปิดวัน</span>
              <span className="metric-value">
                {summary.shutdownDays}/{summary.workdaysSoFar} วัน
              </span>
            </div>
          </div>
          {summary.done.length > 0 ? (
            <ul className="ritual-list">
              {summary.done.slice(0, FIRST_DONE).map((l) => (
                <li key={l.id}>{l.title}</li>
              ))}
              {summary.done.length > FIRST_DONE && <li className="muted">และอีก {summary.done.length - FIRST_DONE} งาน</li>}
            </ul>
          ) : (
            <p className="ritual-empty">สัปดาห์นี้ยังไม่มีงานที่ปิด</p>
          )}
          {summary.dropped.length > 0 && <p className="field-note">ทิ้งไป {summary.dropped.length} งาน ซึ่งก็คือการตัดสินใจที่ดีเหมือนกัน</p>}
          {summary.chronic.length > 0 && (
            <p className="field-note">
              เลื่อนบ่อย: {summary.chronic.map((l) => `${l.title} (${l.rolloverCount} ครั้ง)`).join(', ')}
            </p>
          )}
        </>
      )}

      {step === 1 && (
        <>
          <p className="ritual-lead">งานที่เลยกำหนด นิ่งนาน หรือเลื่อนบ่อย ตัดสินใจทีละงาน ถ้ายังจะทำต่อก็เลือก "ทำต่อ" ได้</p>
          {review.length === 0 && <p className="ritual-empty">ไม่มีงานค้างให้เคลียร์</p>}
          {review.map(({ loop, reason }) => (
            <article key={loop.id} className="ritual-item">
              <div className="ri-head">
                <span className="ri-title">{loop.title}</span>
                <span className="badge tone-warn">{reason}</span>
              </div>
              <DecisionPicker
                label={`จะทำอย่างไรกับ ${loop.title}`}
                options={['keep', 'split', 'delegate', 'tray-later', 'drop', 'done']}
                labels={{ keep: 'ทำต่อ' }}
                value={clear[loop.id]}
                onChange={(d) => setClear({ ...clear, [loop.id]: d })}
                splitCarries={false}
                error={null}
              />
            </article>
          ))}
        </>
      )}

      {step === 2 && (
        <>
          <Chips
            label="วางแผนสัปดาห์ไหน"
            options={[
              { value: thisWeek, label: 'สัปดาห์นี้' },
              { value: addDays(thisWeek, 7), label: 'สัปดาห์หน้า' },
            ]}
            value={targetWeek}
            onChange={switchWeek}
          />
          <p className="ritual-lead">
            {formatWeekRange(targetWeek)} · วางงานไว้ {formatMinutes(week.plannedMinutes)} จากเวลาว่าง {formatMinutes(week.freeMinutes)}
          </p>
          <div className="week-strip">
            {week.days
              .filter((d) => d.isWorkday && !d.isPast)
              .map((d) => (
                <div key={d.date} className={`strip-day tone-${d.load.tone}`}>
                  <span className="strip-name">{formatShortDay(d.date)}</span>
                  <span className="strip-load">
                    {formatMinutes(d.load.plannedMinutes)} / {formatMinutes(d.load.freeMinutes)}
                  </span>
                  <CapacityBar load={d.load} label={`${formatShortDay(d.date)} วางไว้ ${formatMinutes(d.load.plannedMinutes)}`} compact />
                </div>
              ))}
          </div>
          {candidates.length === 0 && <p className="ritual-empty">กองงานว่าง ไม่มีงานที่ต้องลงวัน</p>}
          {candidates.map((loop) => (
            <article key={loop.id} className="ritual-item">
              <div className="ri-head">
                <span className="ri-title">{loop.title}</span>
                <span className="badge">{loop.horizon === 'week' ? 'สัปดาห์นี้ ไม่ระบุวัน' : HORIZON_LABEL[loop.horizon]}</span>
                {loop.estimateMinutes !== null && <span className="badge">{formatMinutes(loop.estimateMinutes)}</span>}
              </div>
              <DecisionPicker
                label={`ลงวันให้ ${loop.title}`}
                days={dayOptions}
                options={loop.horizon === 'week' ? ['tray-later', 'drop', 'keep'] : ['keep', 'drop']}
                value={plan[loop.id] ?? { kind: 'keep' }}
                onChange={(d) => setPlan({ ...plan, [loop.id]: d })}
                splitCarries={false}
                error={null}
              />
            </article>
          ))}
        </>
      )}

      {step === 3 && (
        <>
          <p className="ritual-lead">ตรวจสรุปก่อนบันทึก บันทึกแล้วยังกดเลิกทำได้</p>
          <ul className="ritual-counts">
            {counts.schedule ? (
              <li>
                <strong>{counts.schedule}</strong> ลงวันแล้ว
              </li>
            ) : null}
            {counts.split ? (
              <li>
                <strong>{counts.split}</strong> แตกย่อย
              </li>
            ) : null}
            {counts.delegate ? (
              <li>
                <strong>{counts.delegate}</strong> มอบหมาย
              </li>
            ) : null}
            {counts.tray ? (
              <li>
                <strong>{counts.tray}</strong> ไว้ก่อน
              </li>
            ) : null}
            {counts.drop ? (
              <li>
                <strong>{counts.drop}</strong> ทิ้ง
              </li>
            ) : null}
            {counts.done ? (
              <li>
                <strong>{counts.done}</strong> เสร็จแล้ว
              </li>
            ) : null}
          </ul>
          <p className="field-note">
            {formatWeekRange(targetWeek)}: วางงานไว้ {formatMinutes(week.plannedMinutes)} จากเวลาว่าง {formatMinutes(week.freeMinutes)}
          </p>
          <div className="backup-nudge">
            <span>
              ปิดท้ายสัปดาห์ด้วยการสำรองข้อมูล{' '}
              <span className="muted">
                {lastBackupAt ? `(ล่าสุด ${withDay('', dateKeyOf(lastBackupAt), today).trim()})` : '(ยังไม่เคยสำรอง)'}
              </span>
            </span>
            <button type="button" onClick={onBackup}>
              ดาวน์โหลดไฟล์สำรอง
            </button>
          </div>
        </>
      )}
    </RitualFrame>
  )
}
