import type { ReactNode } from 'react'

export interface ChipOption<T> {
  value: T
  label: string
}

interface ChipsProps<T> {
  label: string
  options: ChipOption<T>[]
  value: T
  onChange: (value: T) => void
  children?: ReactNode
}

/** กลุ่มปุ่มเลือกแทนการพิมพ์ เลือกได้ทีละค่า */
export function Chips<T>({ label, options, value, onChange, children }: ChipsProps<T>) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className="chip"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
      {children}
    </div>
  )
}
