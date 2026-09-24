import { useEffect, useId, useRef, type ReactNode } from 'react'
import type { DateKey } from '../domain/dates'
import type { Decision } from '../domain/rituals'
import { Chips, type ChipOption } from './Chips'
import { Icon } from './Icon'

// โครงของพิธีปิดวัน/ทบทวนสัปดาห์: ทีละขั้น ย้อนกลับได้ บันทึกตอนจบ

interface FrameProps {
  title: string
  steps: string[]
  step: number
  nextLabel: string
  onBack: () => void
  onNext: () => void
  onCancel: () => void
  children: ReactNode
}

export function RitualFrame({ title, steps, step, nextLabel, onBack, onNext, onCancel, children }: FrameProps) {
  const heading = useRef<HTMLHeadingElement>(null)
  const first = useRef(true)

  // ย้าย focus ไปหัวข้อของขั้นใหม่ คนใช้คีย์บอร์ดและ screen reader จะได้รู้ว่าเปลี่ยนขั้นแล้ว
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    heading.current?.focus()
  }, [step])

  return (
    <section className="ritual" aria-labelledby="ritual-step">
      <header className="ritual-head">
        <div>
          <p className="ritual-kicker">
            {title} · ขั้น {step + 1}/{steps.length}
          </p>
          <h2 id="ritual-step" ref={heading} tabIndex={-1}>
            {steps[step]}
          </h2>
        </div>
        <button type="button" className="ghost" onClick={onCancel}>
          <Icon name="x" /> ออก
        </button>
      </header>
      <ol className="ritual-steps" aria-label="ขั้นตอน">
        {steps.map((s, i) => (
          <li key={s} aria-current={i === step ? 'step' : undefined} data-done={i < step}>
            {s}
          </li>
        ))}
      </ol>
      <div className="ritual-body">{children}</div>
      <footer className="ritual-foot">
        {step > 0 && (
          <button type="button" onClick={onBack}>
            ย้อนกลับ
          </button>
        )}
        <button type="button" className="primary" onClick={onNext}>
          {nextLabel}
        </button>
      </footer>
    </section>
  )
}

export type DecisionOption = 'done' | 'carry' | 'keep' | 'tray-week' | 'tray-later' | 'drop' | 'split' | 'delegate'

const OPTION_LABEL: Record<DecisionOption, string> = {
  done: 'เสร็จแล้ว',
  carry: 'ทำต่อ',
  keep: 'ไม่เปลี่ยน',
  'tray-week': 'กลับกองงาน',
  'tray-later': 'ไว้ก่อน',
  drop: 'ทิ้ง',
  split: 'แตกย่อย',
  delegate: 'มอบหมาย',
}

function keyOf(decision: Decision | null | undefined): string | null {
  if (!decision) return null
  if (decision.kind === 'tray') return `tray-${decision.horizon}`
  if (decision.kind === 'schedule') return `day:${decision.date}`
  return decision.kind
}

interface PickerProps {
  label: string
  options: DecisionOption[]
  days?: { date: DateKey; label: string }[]
  labels?: Partial<Record<DecisionOption, string>>
  value: Decision | null | undefined
  onChange: (decision: Decision) => void
  /** แตกย่อยแล้วยกไปวันทำงานถัดไปด้วยหรือไม่ */
  splitCarries: boolean
  error: string | null
}

/** ปุ่มเลือกการตัดสินใจของลูปหนึ่งตัว พร้อมช่องกรอกเมื่อแตกย่อยหรือมอบหมาย */
export function DecisionPicker({ label, options, days = [], labels = {}, value, onChange, splitCarries, error }: PickerProps) {
  const ids = useId()
  const chips: ChipOption<string>[] = [
    ...days.map((d) => ({ value: `day:${d.date}`, label: d.label })),
    ...options.map((o) => ({ value: o, label: labels[o] ?? OPTION_LABEL[o] })),
  ]

  function pick(key: string) {
    if (key.startsWith('day:')) return onChange({ kind: 'schedule', date: key.slice(4) })
    switch (key as DecisionOption) {
      case 'tray-week':
        return onChange({ kind: 'tray', horizon: 'week' })
      case 'tray-later':
        return onChange({ kind: 'tray', horizon: 'later' })
      case 'split':
        return onChange({ kind: 'split', firstStep: value?.kind === 'split' ? value.firstStep : '', carry: splitCarries })
      case 'delegate':
        return onChange({ kind: 'delegate', to: value?.kind === 'delegate' ? value.to : '' })
      default:
        return onChange({ kind: key as 'done' | 'carry' | 'keep' | 'drop' })
    }
  }

  return (
    <div className="decision">
      <Chips label={label} options={chips} value={keyOf(value) ?? ''} onChange={pick} />
      {value?.kind === 'split' && (
        <div className="field">
          <label className="field-label" htmlFor={`${ids}-split`}>
            ขั้นแรกที่ทำได้ใน 15 นาที
          </label>
          <input
            id={`${ids}-split`}
            placeholder="เปิดไฟล์แล้วเขียนหัวข้อ 3 ข้อ"
            value={value.firstStep}
            onChange={(e) => onChange({ ...value, firstStep: e.target.value })}
            aria-invalid={!!error}
            autoComplete="off"
          />
        </div>
      )}
      {value?.kind === 'delegate' && (
        <div className="field">
          <label className="field-label" htmlFor={`${ids}-to`}>
            มอบให้ใคร <span className="muted">งานจะเป็น "รอคนอื่น" และเตือนให้ตามอีก 3 วันทำการ</span>
          </label>
          <input
            id={`${ids}-to`}
            placeholder="น้องบี ทีมขาย"
            value={value.to}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            aria-invalid={!!error}
            autoComplete="off"
          />
        </div>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
