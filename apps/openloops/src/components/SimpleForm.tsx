import { useId, useState, type FormEvent } from 'react'
import type { DateKey } from '../domain/dates'
import { TABS, TAB_LABEL, dueOptions, validateTitle, type SimpleValues } from '../domain/simple'
import { Chips } from './Chips'
import { Icon } from './Icon'

interface Props {
  mode: 'create' | 'edit'
  initial: SimpleValues
  today: DateKey
  /** แสดงจำนวนขั้นย่อยที่มีอยู่ (แก้ขั้นได้ในโหมดละเอียด) */
  steps?: { done: number; total: number }
  onSave: (values: SimpleValues) => void
  onCancel: () => void
  onDelete?: () => void
}

/** ฟอร์มสั้นของโหมดง่าย: ชื่องาน, อยู่ในแท็บไหน, เสร็จภายในวันไหน */
export function SimpleForm({ mode, initial, today, steps, onSave, onCancel, onDelete }: Props) {
  const ids = useId()
  const [values, setValues] = useState<SimpleValues>(initial)
  const [error, setError] = useState<string | null>(null)
  const dues = dueOptions(today)
  const customDue = values.dueDate !== null && !dues.some((o) => o.value === values.dueDate)

  function submit(e: FormEvent) {
    e.preventDefault()
    const found = validateTitle(values.title)
    setError(found)
    if (found) return
    onSave(values)
  }

  return (
    <form className="capture simple-form" onSubmit={submit} noValidate>
      <div className="capture-head">
        <h2>{mode === 'create' ? 'จดงาน' : 'แก้ไขงาน'}</h2>
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
          className="title-input"
          placeholder="ส่งใบเสนอราคาลูกค้า ABC"
          value={values.title}
          onChange={(e) => {
            setValues({ ...values, title: e.target.value })
            setError(null)
          }}
          aria-invalid={!!error}
          data-autofocus
          autoComplete="off"
        />
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {steps && steps.total > 0 && (
          <p className="field-note">
            มีขั้นย่อย {steps.total} ขั้น (ทำแล้ว {steps.done}) แก้ขั้นย่อยได้ในโหมดละเอียด
          </p>
        )}
      </div>

      <div className="field">
        <span className="field-label">อยู่ในรายการ</span>
        <Chips
          label="อยู่ในรายการ"
          options={TABS.map((t) => ({ value: t, label: TAB_LABEL[t] }))}
          value={values.tab}
          onChange={(tab) => setValues({ ...values, tab })}
        />
      </div>

      <div className="field">
        <span className="field-label">เสร็จภายใน</span>
        <Chips label="เสร็จภายใน" options={dues} value={values.dueDate} onChange={(dueDate) => setValues({ ...values, dueDate })}>
          <input
            type="date"
            className="chip chip-date"
            aria-label="เลือกวันที่จะเสร็จเอง"
            value={values.dueDate ?? ''}
            data-custom={customDue}
            onChange={(e) => setValues({ ...values, dueDate: e.target.value || null })}
          />
        </Chips>
      </div>

      <div className="capture-foot">
        {onDelete && (
          <button type="button" className="ghost danger-text" onClick={onDelete}>
            ลบงานนี้
          </button>
        )}
        <span className="spacer" />
        <button type="button" onClick={onCancel}>
          ยกเลิก
        </button>
        <button type="submit" className="primary">
          บันทึก
        </button>
      </div>
    </form>
  )
}
