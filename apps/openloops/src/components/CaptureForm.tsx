import { useId, useRef, useState, type FormEvent } from 'react'
import { addDays, nextWeekday, type DateKey } from '../domain/dates'
import {
  ENERGY_LABEL,
  HORIZON_LABEL,
  newStep,
  validateDraft,
  type DraftErrors,
  type Energy,
  type Horizon,
  type LoopDraft,
} from '../domain/loop'
import { Chips, type ChipOption } from './Chips'
import { Icon } from './Icon'

interface Props {
  mode: 'create' | 'edit'
  initial: LoopDraft
  projects: string[]
  today: DateKey
  onSave: (draft: LoopDraft) => void
  onCancel: () => void
}

const HORIZONS: ChipOption<Horizon>[] = (['today', 'week', 'later'] as const).map((h) => ({
  value: h,
  label: HORIZON_LABEL[h],
}))

const ESTIMATES: ChipOption<number | null>[] = [
  { value: null, label: 'ไม่ระบุ' },
  { value: 15, label: '15 นาที' },
  { value: 30, label: '30 นาที' },
  { value: 60, label: '1 ชม.' },
  { value: 120, label: '2 ชม.' },
  { value: 240, label: '4 ชม.' },
]

const ENERGIES: ChipOption<Energy | null>[] = [
  { value: null, label: 'ไม่ระบุ' },
  { value: 'deep', label: ENERGY_LABEL.deep },
  { value: 'shallow', label: ENERGY_LABEL.shallow },
]

export function CaptureForm({ mode, initial, projects, today, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<LoopDraft>(initial)
  const [errors, setErrors] = useState<DraftErrors>({})
  const [stepText, setStepText] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  const ids = useId()

  // ตัดตัวเลือกที่ตรงกับวันเดียวกันออก เช่น วันศุกร์ "ศุกร์นี้" คือ "วันนี้"
  const dueOptions = (
    [
      { value: null, label: 'ไม่มี' },
      { value: today, label: 'วันนี้' },
      { value: addDays(today, 1), label: 'พรุ่งนี้' },
      { value: nextWeekday(today, 5), label: 'ศุกร์นี้' },
      { value: nextWeekday(addDays(today, 1), 1), label: 'จันทร์หน้า' },
    ] as ChipOption<DateKey | null>[]
  ).filter((o, i, all) => all.findIndex((x) => x.value === o.value) === i)

  function update(patch: Partial<LoopDraft>) {
    setDraft((d) => ({ ...d, ...patch }))
    if ('title' in patch && errors.title) setErrors((e) => ({ ...e, title: undefined }))
  }

  function addPendingStep() {
    if (!stepText.trim()) return
    update({ steps: [...draft.steps, newStep(stepText)] })
    setStepText('')
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    // ขั้นที่พิมพ์ค้างไว้แต่ยังไม่กด Enter ก็นับด้วย จะได้ไม่หายเงียบ ๆ
    const final = stepText.trim() ? { ...draft, steps: [...draft.steps, newStep(stepText)] } : draft
    const found = validateDraft(final)
    setErrors(found)
    if (Object.keys(found).length) {
      titleRef.current?.focus()
      return
    }
    onSave(final)
  }

  return (
    <form className="capture" onSubmit={submit} noValidate>
      <div className="capture-head">
        <h2>{mode === 'create' ? 'จดงานใหม่' : 'แก้ไขงาน'}</h2>
        <button type="button" className="icon-btn" onClick={onCancel} aria-label="ปิด">
          <Icon name="x" size={18} />
        </button>
      </div>

      <div className="field">
        <label htmlFor={`${ids}-title`} className="sr-only">
          ชื่องาน
        </label>
        <input
          id={`${ids}-title`}
          ref={titleRef}
          className="title-input"
          placeholder="ส่งใบเสนอราคาลูกค้า ABC"
          value={draft.title}
          onChange={(e) => update({ title: e.target.value })}
          aria-invalid={!!errors.title}
          aria-describedby={errors.title ? `${ids}-title-err` : undefined}
          data-autofocus
          autoComplete="off"
        />
        {errors.title && (
          <p id={`${ids}-title-err`} className="field-error" role="alert">
            {errors.title}
          </p>
        )}
      </div>

      <div className="field">
        <span className="field-label">ทำเมื่อไหร่</span>
        <Chips label="ทำเมื่อไหร่" options={HORIZONS} value={draft.horizon} onChange={(horizon) => update({ horizon })} />
      </div>

      <div className="field">
        <span className="field-label">กำหนดส่ง</span>
        <Chips label="กำหนดส่ง" options={dueOptions} value={draft.dueDate} onChange={(dueDate) => update({ dueDate })}>
          <input
            type="date"
            className="chip chip-date"
            aria-label="เลือกวันส่งเอง"
            value={draft.dueDate ?? ''}
            data-custom={draft.dueDate !== null && !dueOptions.some((o) => o.value === draft.dueDate)}
            onChange={(e) => update({ dueDate: e.target.value || null })}
          />
        </Chips>
      </div>

      <div className="field">
        <span className="field-label">ใช้เวลาประมาณ</span>
        <Chips
          label="ใช้เวลาประมาณ"
          options={ESTIMATES}
          value={draft.estimateMinutes}
          onChange={(estimateMinutes) => update({ estimateMinutes })}
        />
        {errors.estimate && <p className="field-error">{errors.estimate}</p>}
      </div>

      <div className="field">
        <span className="field-label">ลักษณะงาน</span>
        <Chips label="ลักษณะงาน" options={ENERGIES} value={draft.energy} onChange={(energy) => update({ energy })} />
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${ids}-project`}>
          โปรเจกต์
        </label>
        {projects.length > 0 && (
          <Chips
            label="โปรเจกต์ที่มีอยู่"
            options={projects.slice(0, 6).map((p) => ({ value: p, label: p }))}
            value={draft.project}
            onChange={(project) => update({ project: draft.project === project ? '' : project })}
          />
        )}
        <input
          id={`${ids}-project`}
          placeholder={projects.length ? 'หรือพิมพ์ชื่อโปรเจกต์ใหม่' : 'ไม่บังคับ'}
          value={draft.project}
          onChange={(e) => update({ project: e.target.value })}
          autoComplete="off"
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${ids}-step`}>
          ขั้นตอน <span className="muted">แตกงานเป็นขั้น จะรู้เสมอว่าค้างอยู่ตรงไหน</span>
        </label>
        {draft.steps.length > 0 && (
          <ol className="draft-steps">
            {draft.steps.map((s, i) => (
              <li key={s.id} className={s.doneAt ? 'is-done' : undefined}>
                <span className="step-no">{i + 1}</span>
                <span className="step-title">{s.title}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`ลบขั้น ${s.title}`}
                  onClick={() => update({ steps: draft.steps.filter((x) => x.id !== s.id) })}
                >
                  <Icon name="x" size={14} />
                </button>
              </li>
            ))}
          </ol>
        )}
        <div className="inline-add">
          <input
            id={`${ids}-step`}
            placeholder={draft.steps.length ? 'ขั้นถัดไป' : 'ขอราคาจากซัพพลายเออร์'}
            value={stepText}
            onChange={(e) => setStepText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                addPendingStep()
              }
            }}
            autoComplete="off"
          />
          <button type="button" onClick={addPendingStep}>
            <Icon name="plus" /> เพิ่มขั้น
          </button>
        </div>
      </div>

      <div className="capture-foot">
        <span className="muted hint">กด Enter ที่ชื่องานเพื่อบันทึกได้เลย</span>
        <button type="button" onClick={onCancel}>
          ยกเลิก
        </button>
        <button type="submit" className="primary">
          {mode === 'create' ? 'บันทึก' : 'บันทึกการแก้ไข'}
        </button>
      </div>
    </form>
  )
}
