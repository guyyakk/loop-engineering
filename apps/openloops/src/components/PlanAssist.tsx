import { useId, useState } from 'react'
import type { AiAssist } from '../aiClient'
import { applyAiPlan, planChangeIds, type AiPlan } from '../domain/ai'
import { loadForDay, remainingMinutes, type Busy, type DayLoad, type PlannerSettings } from '../domain/capacity'
import { formatMinutes, withDay, type DateKey } from '../domain/dates'
import type { Loop } from '../domain/loop'
import { useAiCall } from '../useAiCall'
import { Icon } from './Icon'
import { CapacityBar } from './TodayPanel'

interface Props {
  loops: Loop[]
  today: DateKey
  settings: PlannerSettings
  load: DayLoad
  busy: Busy
  postponeDate: DateKey
  ai: AiAssist
  onApply: (changed: Loop[], previous: Loop[]) => void
}

/** แผนเช้าจาก AI: เสนอลำดับงานพร้อมเหตุผล ผู้ใช้เลือกการย้ายเองแล้วค่อยใช้ */
export function PlanAssist({ loops, today, settings, load, busy, postponeDate, ai, onApply }: Props) {
  const ids = useId()
  const call = useAiCall()
  const [plan, setPlan] = useState<AiPlan | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [applied, setApplied] = useState(false)

  async function ask() {
    setApplied(false)
    const result = await call.run((signal) => ai.plan(loops, { today, settings, load, postponeDate }, signal))
    if (!result) return
    setPlan(result)
    setSelected(new Set(planChangeIds(result)))
  }

  function toggle(id: string) {
    const next = new Set(selected)
    if (!next.delete(id)) next.add(id)
    setSelected(next)
  }

  function close() {
    setPlan(null)
    setApplied(false)
  }

  const now = new Date()
  const preview = plan ? applyAiPlan(loops, plan, selected, now, postponeDate) : null
  const previewLoops = preview ? loops.map((l) => preview.changed.find((c) => c.id === l.id) ?? l) : loops
  const after = loadForDay(previewLoops, today, today, settings, busy)
  const size = (l: Loop) => (remainingMinutes(l) === null ? 'ยังไม่ประเมินเวลา' : formatMinutes(remainingMinutes(l)!))

  if (!plan) {
    return (
      <section className="plan-assist" aria-labelledby={`${ids}-h`}>
        <h2 id={`${ids}-h`} className="sr-only">
          แผนเช้าจาก AI
        </h2>
        <div className="ai-row">
          <button type="button" className="chip ai-btn" onClick={() => void ask()} disabled={call.busy}>
            <Icon name="sparkle" size={14} /> {call.busy ? 'AI กำลังจัดแผน…' : 'ให้ AI จัดแผนวันนี้'}
          </button>
          {call.busy ? (
            <button type="button" className="link-btn" onClick={call.cancel}>
              ยกเลิก
            </button>
          ) : (
            <span className="field-note">เรียงลำดับงานให้พอดีเวลาว่าง พร้อมเหตุผล คุณเลือกเองก่อนใช้</span>
          )}
        </div>
        {call.error && (
          <p className="field-error" role="alert">
            {call.error}
          </p>
        )}
      </section>
    )
  }

  const changes = planChangeIds(plan).length
  return (
    <section className="plan-assist is-open" aria-labelledby={`${ids}-h`}>
      <div className="pa-head">
        <h2 id={`${ids}-h`}>
          <Icon name="sparkle" /> {applied ? 'ลำดับงานที่ AI แนะนำ' : 'แผนวันนี้ที่ AI เสนอ'}
        </h2>
        <button type="button" className="icon-btn" onClick={close} aria-label="ปิดแผนจาก AI">
          <Icon name="x" size={16} />
        </button>
      </div>
      {plan.summary && <p className="pa-summary">{plan.summary}</p>}

      {plan.order.length > 0 ? (
        <ol className="pa-list">
          {plan.order.map(({ loop, reason, pull }) => (
            <li key={loop.id}>
              <div className="pa-line">
                <span className="pa-title">{loop.title}</span>
                <span className="muted">{size(loop)}</span>
              </div>
              {reason && <p className="pa-reason">{reason}</p>}
              {pull && !applied && (
                <label className="pa-move">
                  <input type="checkbox" checked={selected.has(loop.id)} onChange={() => toggle(loop.id)} />
                  ดึงเข้าวันนี้
                </label>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="field-note">AI ไม่ได้เสนองานสำหรับวันนี้</p>
      )}

      {plan.postpone.length > 0 && !applied && (
        <div className="pa-postpone">
          <p className="field-label">{withDay('ควรเลื่อนไป', postponeDate, today)}</p>
          <ul className="pa-list">
            {plan.postpone.map(({ loop, reason }) => (
              <li key={loop.id}>
                <label className="pa-move">
                  <input type="checkbox" checked={selected.has(loop.id)} onChange={() => toggle(loop.id)} />
                  <span className="pa-title">{loop.title}</span>
                  <span className="muted">{size(loop)}</span>
                </label>
                {reason && <p className="pa-reason">{reason}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.ignored > 0 && !applied && (
        <p className="field-note">ข้ามคำแนะนำที่ผิดกติกา {plan.ignored} รายการ (เช่น เลื่อนงานที่ต้องส่งวันนี้)</p>
      )}

      {!applied && (
        <>
          <p className="field-label">
            หลังใช้แผน: วางงานไว้ {formatMinutes(after.plannedMinutes)} จากเวลาว่าง {formatMinutes(after.freeMinutes)}
          </p>
          <CapacityBar
            load={after}
            label={`หลังใช้แผน วางงานไว้ ${formatMinutes(after.plannedMinutes)} จากเวลาว่าง ${formatMinutes(after.freeMinutes)}`}
            compact
          />
          <div className="row-end">
            <button type="button" className="ghost" onClick={close}>
              ไม่ใช้
            </button>
            {changes > 0 ? (
              <button
                type="button"
                className="primary"
                disabled={!preview?.changed.length}
                onClick={() => {
                  if (!preview) return
                  onApply(preview.changed, preview.previous)
                  setApplied(true)
                }}
              >
                ใช้แผนนี้ ({preview?.changed.length ?? 0} งาน)
              </button>
            ) : (
              <button type="button" className="primary" onClick={() => setApplied(true)}>
                เข้าใจแล้ว ไม่ต้องย้ายงาน
              </button>
            )}
          </div>
        </>
      )}
    </section>
  )
}
