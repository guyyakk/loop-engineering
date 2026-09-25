import { useId, useRef, useState, type FormEvent } from 'react'
import type { AiAssist } from '../aiClient'
import { applyCapture } from '../domain/ai'
import { addDays, formatMinutes, nextWeekday, type DateKey } from '../domain/dates'
import { newStep, validateDraft, type DraftErrors, type LoopDraft } from '../domain/loop'
import { useAiCall } from '../useAiCall'
import { Chips, type ChipOption } from './Chips'
import { Icon } from './Icon'
import { ENERGY_OPTIONS, ESTIMATE_OPTIONS, HORIZON_OPTIONS } from './options'

interface Props {
  mode: 'create' | 'edit'
  initial: LoopDraft
  projects: string[]
  today: DateKey
  onSave: (draft: LoopDraft) => void
  onCancel: () => void
  /** ผู้ช่วย AI (null = ยังไม่ได้ตั้งค่า ไม่แสดงปุ่ม AI) */
  ai?: AiAssist | null
}

export function CaptureForm({ mode, initial, projects, today, onSave, onCancel, ai = null }: Props) {
  const [draft, setDraft] = useState<LoopDraft>(initial)
  const [errors, setErrors] = useState<DraftErrors>({})
  const [stepText, setStepText] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  const ids = useId()
  const parsing = useAiCall()
  const splitting = useAiCall()
  /** ฟอร์มก่อนให้ AI กรอก ไว้กดย้อนกลับ */
  const [beforeAi, setBeforeAi] = useState<LoopDraft | null>(null)
  const [suggested, setSuggested] = useState<{ steps: string[]; chosen: boolean[] } | null>(null)
  // ฟอร์มล่าสุด ผู้ใช้อาจแก้ช่องอื่นระหว่างรอ AI
  const latest = useRef(draft)
  latest.current = draft

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

  // เวลาประมาณที่ไม่ตรงปุ่ม (เช่น จาก AI) แสดงเป็นปุ่มเพิ่ม จะได้เห็นค่าที่เลือกอยู่
  const estimateOptions =
    draft.estimateMinutes === null || ESTIMATE_OPTIONS.some((o) => o.value === draft.estimateMinutes)
      ? ESTIMATE_OPTIONS
      : [...ESTIMATE_OPTIONS, { value: draft.estimateMinutes, label: formatMinutes(draft.estimateMinutes) }].sort(
          (a, b) => (a.value ?? 0) - (b.value ?? 0),
        )

  async function fillWithAi() {
    if (!ai || !draft.title.trim()) return
    const result = await parsing.run((signal) => ai.capture(draft.title, signal))
    if (!result) return
    const before = latest.current
    setBeforeAi(before)
    setDraft(applyCapture(before, result))
    setErrors({})
  }

  function undoAi() {
    if (beforeAi) setDraft(beforeAi)
    setBeforeAi(null)
    titleRef.current?.focus()
  }

  async function suggestSteps() {
    if (!ai || !draft.title.trim()) return
    const steps = await splitting.run((signal) =>
      ai.breakdown(
        {
          title: draft.title,
          project: draft.project.trim() || null,
          estimateMinutes: draft.estimateMinutes,
          steps: draft.steps.map((s) => s.title),
        },
        signal,
      ),
    )
    if (steps) setSuggested({ steps, chosen: steps.map(() => true) })
  }

  function addSuggested() {
    if (!suggested) return
    const picked = suggested.steps.filter((_, i) => suggested.chosen[i])
    update({ steps: [...draft.steps, ...picked.map(newStep)] })
    setSuggested(null)
  }

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
          placeholder={ai && mode === 'create' ? 'พิมพ์เป็นประโยคก็ได้ เช่น พรุ่งนี้ส่งใบเสนอราคา ABC ใช้ 2 ชม.' : 'ส่งใบเสนอราคาลูกค้า ABC'}
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
        {ai && mode === 'create' && (
          <div className="ai-row">
            <button
              type="button"
              className="chip ai-btn"
              onClick={() => void fillWithAi()}
              disabled={parsing.busy || !draft.title.trim()}
            >
              <Icon name="sparkle" size={14} /> {parsing.busy ? 'AI กำลังอ่านประโยค…' : 'ให้ AI แยกรายละเอียด'}
            </button>
            {parsing.busy && (
              <button type="button" className="link-btn" onClick={parsing.cancel}>
                ยกเลิก
              </button>
            )}
            {beforeAi && !parsing.busy && (
              <span className="field-note" role="status">
                AI กรอกให้แล้ว ตรวจก่อนบันทึก ·{' '}
                <button type="button" className="link-btn" onClick={undoAi}>
                  ย้อนกลับ
                </button>
              </span>
            )}
          </div>
        )}
        {parsing.error && (
          <p className="field-error" role="alert">
            {parsing.error}
          </p>
        )}
      </div>

      <div className="field">
        <span className="field-label">ทำเมื่อไหร่</span>
        <Chips label="ทำเมื่อไหร่" options={HORIZON_OPTIONS} value={draft.horizon} onChange={(horizon) => update({ horizon })} />
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
          options={estimateOptions}
          value={draft.estimateMinutes}
          onChange={(estimateMinutes) => update({ estimateMinutes })}
        />
        {errors.estimate && <p className="field-error">{errors.estimate}</p>}
      </div>

      <div className="field">
        <span className="field-label">ลักษณะงาน</span>
        <Chips label="ลักษณะงาน" options={ENERGY_OPTIONS} value={draft.energy} onChange={(energy) => update({ energy })} />
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
        {ai && !suggested && (
          <div className="ai-row">
            <button
              type="button"
              className="chip ai-btn"
              onClick={() => void suggestSteps()}
              disabled={splitting.busy || !draft.title.trim()}
            >
              <Icon name="sparkle" size={14} /> {splitting.busy ? 'AI กำลังคิดขั้นตอน…' : 'ให้ AI ช่วยแตกขั้น'}
            </button>
            {splitting.busy && (
              <button type="button" className="link-btn" onClick={splitting.cancel}>
                ยกเลิก
              </button>
            )}
          </div>
        )}
        {splitting.error && (
          <p className="field-error" role="alert">
            {splitting.error}
          </p>
        )}
        {suggested && (
          <fieldset className="ai-suggest">
            <legend>ขั้นที่ AI เสนอ เลือกเฉพาะที่ใช้</legend>
            {suggested.steps.map((step, i) => (
              <label key={step}>
                <input
                  type="checkbox"
                  checked={suggested.chosen[i]}
                  onChange={() =>
                    setSuggested({ ...suggested, chosen: suggested.chosen.map((c, j) => (j === i ? !c : c)) })
                  }
                />
                <span>{step}</span>
              </label>
            ))}
            <div className="row-end">
              <button type="button" className="ghost" onClick={() => setSuggested(null)}>
                ไม่เอา
              </button>
              <button type="button" className="primary" onClick={addSuggested} disabled={!suggested.chosen.some(Boolean)}>
                เพิ่ม {suggested.chosen.filter(Boolean).length} ขั้น
              </button>
            </div>
          </fieldset>
        )}
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
