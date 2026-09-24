import { useId, useState } from 'react'
import { remainingMinutes } from '../domain/capacity'
import { addDays, dueTone, formatMinutes, nextWeekday, withDay, type DateKey } from '../domain/dates'
import {
  ENERGY_LABEL,
  STATUS_LABEL,
  addStep,
  advance,
  isClosed,
  nextStep,
  progress,
  setEstimate,
  setHorizon,
  setStatus,
  toggleStep,
  validateWaiting,
  type Loop,
  type LoopStatus,
} from '../domain/loop'
import { Chips, type ChipOption } from './Chips'
import { Icon } from './Icon'
import { ESTIMATE_OPTIONS, HORIZON_OPTIONS } from './options'

interface Props {
  loop: Loop
  today: DateKey
  onChange: (next: Loop, prev: Loop) => void
  onEdit: (loop: Loop) => void
  onPostpone: (loop: Loop) => void
}

const STATUSES: LoopStatus[] = ['active', 'waiting', 'blocked', 'done', 'dropped']

/** "ยกมาจากเมื่อวาน" สำหรับการยกครั้งแรกของวันนี้ ไม่เช่นนั้นบอกจำนวนครั้งที่เลื่อน */
function rolloverLabel(loop: Loop, today: DateKey): string | null {
  if (loop.rolloverCount === 0) return null
  if (loop.rolloverCount === 1 && loop.carriedOn === today) return 'ยกมาจากเมื่อวาน'
  return `เลื่อนมา ${loop.rolloverCount} ครั้ง`
}

function estimateText(loop: Loop, closed: boolean): string | null {
  if (loop.estimateMinutes === null) return null
  const left = remainingMinutes(loop)
  if (!closed && left !== null && left < loop.estimateMinutes) {
    return `เหลือ ${formatMinutes(left)} จาก ${formatMinutes(loop.estimateMinutes)}`
  }
  return formatMinutes(loop.estimateMinutes)
}

export function Dots({ done, total }: { done: number; total: number }) {
  if (total === 0) return null
  if (total > 8) {
    return (
      <span className="bar" aria-hidden="true">
        <span style={{ width: `${(done / total) * 100}%` }} />
      </span>
    )
  }
  return (
    <span className="dots" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < done ? 'on' : undefined} />
      ))}
    </span>
  )
}

export function LoopCard({ loop, today, onChange, onEdit, onPostpone }: Props) {
  const [open, setOpen] = useState(false)
  const [newStepText, setNewStepText] = useState('')
  const [waitingDraft, setWaitingDraft] = useState<{ waitingOn: string; followUpDate: DateKey | null } | null>(null)
  const [waitingErrors, setWaitingErrors] = useState<ReturnType<typeof validateWaiting>>({})
  const ids = useId()

  const closed = isClosed(loop)
  const { done, total } = progress(loop)
  const next = nextStep(loop)
  const change = (updated: Loop) => onChange(updated, loop)
  const rollover = closed ? null : rolloverLabel(loop, today)
  const estimate = estimateText(loop, closed)
  const plannedAhead = !closed && loop.horizon !== 'today' && loop.plannedDate && loop.plannedDate > today ? loop.plannedDate : null

  const followUpOptions = (
    [
      { value: addDays(today, 1), label: 'พรุ่งนี้' },
      { value: addDays(today, 3), label: 'อีก 3 วัน' },
      { value: nextWeekday(addDays(today, 1), 1), label: 'จันทร์หน้า' },
    ] as ChipOption<DateKey | null>[]
  ).filter((o, i, all) => all.findIndex((x) => x.value === o.value) === i)

  function pickStatus(status: LoopStatus) {
    if (status === loop.status) return
    if (status === 'waiting') {
      setWaitingDraft({ waitingOn: '', followUpDate: addDays(today, 3) })
      setWaitingErrors({})
      return
    }
    setWaitingDraft(null)
    change(setStatus(loop, status, new Date()))
  }

  function confirmWaiting() {
    if (!waitingDraft) return
    const errors = validateWaiting(waitingDraft)
    setWaitingErrors(errors)
    if (Object.keys(errors).length) return
    change(setStatus(loop, 'waiting', new Date(), { waitingOn: waitingDraft.waitingOn, followUpDate: waitingDraft.followUpDate }))
    setWaitingDraft(null)
  }

  function submitNewStep() {
    if (!newStepText.trim()) return
    change(addStep(loop, newStepText, new Date()))
    setNewStepText('')
  }

  const subline =
    loop.status === 'waiting' ? (
      <>
        <Icon name="user" size={14} /> รอ {loop.waitingOn}
        {loop.followUpDate && <> · {withDay('ตามงาน', loop.followUpDate, today)}</>}
      </>
    ) : closed ? (
      <>{STATUS_LABEL[loop.status]}แล้ว{total > 0 && ` · ${done}/${total} ขั้น`}</>
    ) : total === 0 ? (
      <span className="muted">ยังไม่ได้แตกขั้น</span>
    ) : (
      <>
        <span className="step-count">
          ขั้น {Math.min(done + 1, total)}/{total}
        </span>
        {next && <span className="next"> · ต่อไป: {next.title}</span>}
      </>
    )

  return (
    <article className={`loop status-${loop.status}`} data-open={open}>
      <div className="loop-row">
        {!closed && (
          <button
            type="button"
            className="advance"
            onClick={() => change(advance(loop, new Date()))}
            aria-label={next ? `ติ๊กขั้น "${next.title}" ว่าเสร็จ` : `ปิดงาน "${loop.title}" ว่าเสร็จ`}
            title={next ? `เสร็จขั้น: ${next.title}` : 'ปิดงานนี้'}
          >
            <Icon name="check" size={14} />
          </button>
        )}
        <button
          type="button"
          className="loop-main"
          aria-expanded={open}
          aria-controls={`${ids}-body`}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="loop-top">
            <span className="loop-title">{loop.title}</span>
            {loop.status === 'blocked' && <span className="badge tone-danger">ติดขัด</span>}
            {loop.status === 'waiting' && <span className="badge tone-info">รอคนอื่น</span>}
            {loop.dueDate && !closed && (
              <span className={`badge due-${dueTone(loop.dueDate, today)}`}>
                <Icon name="flag" size={12} /> {withDay('ส่ง', loop.dueDate, today)}
              </span>
            )}
            {plannedAhead && (
              <span className="badge tone-info">
                <Icon name="arrow" size={12} /> {withDay('ทำ', plannedAhead, today)}
              </span>
            )}
            {rollover && (
              <span className={`badge ${loop.rolloverCount >= 3 ? 'tone-warn' : ''}`}>
                <Icon name="repeat" size={12} /> {rollover}
              </span>
            )}
          </span>
          <span className="loop-sub">
            {loop.status !== 'waiting' && !closed && <Dots done={done} total={total} />}
            <span className="loop-sub-text">{subline}</span>
          </span>
          {(loop.project || estimate || loop.energy) && (
            <span className="loop-meta">
              {loop.project && (
                <span>
                  <Icon name="folder" size={12} /> {loop.project}
                </span>
              )}
              {estimate && (
                <span>
                  <Icon name="clock" size={12} /> {estimate}
                </span>
              )}
              {loop.energy && (
                <span>
                  <Icon name="bolt" size={12} /> {ENERGY_LABEL[loop.energy]}
                </span>
              )}
            </span>
          )}
        </button>
        <span className="chevron" aria-hidden="true">
          <Icon name="chevron" />
        </span>
      </div>

      {open && (
        <div className="loop-body" id={`${ids}-body`}>
          {loop.steps.length > 0 && (
            <ol className="steps">
              {loop.steps.map((s) => (
                <li key={s.id}>
                  <label className={s.doneAt ? 'is-done' : undefined}>
                    <input type="checkbox" checked={!!s.doneAt} onChange={() => change(toggleStep(loop, s.id, new Date()))} />
                    <span>{s.title}</span>
                  </label>
                </li>
              ))}
            </ol>
          )}
          <div className="inline-add">
            <label htmlFor={`${ids}-add`} className="sr-only">
              เพิ่มขั้น
            </label>
            <input
              id={`${ids}-add`}
              placeholder="เพิ่มขั้น แล้วกด Enter"
              value={newStepText}
              onChange={(e) => setNewStepText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submitNewStep()
                }
              }}
              autoComplete="off"
            />
            <button type="button" onClick={submitNewStep}>
              <Icon name="plus" /> เพิ่ม
            </button>
          </div>

          <div className="field">
            <span className="field-label">สถานะ</span>
            <Chips
              label="สถานะ"
              options={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
              value={waitingDraft ? 'waiting' : loop.status}
              onChange={pickStatus}
            />
          </div>

          {waitingDraft && (
            <div className="waiting-form">
              <div className="field">
                <label className="field-label" htmlFor={`${ids}-who`}>
                  รอใคร
                </label>
                <input
                  id={`${ids}-who`}
                  placeholder="พี่นก ฝ่ายบัญชี"
                  value={waitingDraft.waitingOn}
                  onChange={(e) => {
                    setWaitingDraft({ ...waitingDraft, waitingOn: e.target.value })
                    setWaitingErrors((er) => ({ ...er, waitingOn: undefined }))
                  }}
                  aria-invalid={!!waitingErrors.waitingOn}
                  autoFocus
                  autoComplete="off"
                />
                {waitingErrors.waitingOn && (
                  <p className="field-error" role="alert">
                    {waitingErrors.waitingOn}
                  </p>
                )}
              </div>
              <div className="field">
                <span className="field-label">ตามงานวันไหน</span>
                <Chips
                  label="ตามงานวันไหน"
                  options={followUpOptions}
                  value={waitingDraft.followUpDate}
                  onChange={(followUpDate) => setWaitingDraft({ ...waitingDraft, followUpDate })}
                >
                  <input
                    type="date"
                    className="chip chip-date"
                    aria-label="เลือกวันตามงานเอง"
                    value={waitingDraft.followUpDate ?? ''}
                    data-custom={
                      waitingDraft.followUpDate !== null &&
                      !followUpOptions.some((o) => o.value === waitingDraft.followUpDate)
                    }
                    onChange={(e) => setWaitingDraft({ ...waitingDraft, followUpDate: e.target.value || null })}
                  />
                </Chips>
                {waitingErrors.followUpDate && (
                  <p className="field-error" role="alert">
                    {waitingErrors.followUpDate}
                  </p>
                )}
              </div>
              <div className="row-end">
                <button type="button" onClick={() => setWaitingDraft(null)}>
                  ยกเลิก
                </button>
                <button type="button" className="primary" onClick={confirmWaiting}>
                  บันทึกว่ารอ
                </button>
              </div>
            </div>
          )}

          {!closed && (
            <div className="field">
              <span className="field-label">ใช้เวลาประมาณ</span>
              <Chips
                label="ใช้เวลาประมาณ"
                options={ESTIMATE_OPTIONS}
                value={loop.estimateMinutes}
                onChange={(m) => change(setEstimate(loop, m, new Date()))}
              />
            </div>
          )}

          {!closed && (
            <div className="field">
              <span className="field-label">ทำเมื่อไหร่</span>
              <Chips
                label="ทำเมื่อไหร่"
                options={HORIZON_OPTIONS}
                value={loop.horizon}
                onChange={(h) => change(setHorizon(loop, h, new Date()))}
              />
            </div>
          )}

          <div className="row-end">
            {!closed && loop.horizon === 'today' && (
              <button type="button" onClick={() => onPostpone(loop)}>
                <Icon name="arrow" /> เลื่อนไปพรุ่งนี้
              </button>
            )}
            <button type="button" onClick={() => onEdit(loop)}>
              <Icon name="edit" /> แก้ไขรายละเอียด
            </button>
          </div>
        </div>
      )}
    </article>
  )
}
