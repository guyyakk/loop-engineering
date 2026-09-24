import { useId, useState } from 'react'
import type { Loop } from '../domain/loop'
import type { Nudge, NudgeKind } from '../domain/nudges'
import { Icon, type IconName } from './Icon'

interface Props {
  nudges: Nudge[]
  onPull: (loop: Loop) => void
  onOpen: (loop: Loop) => void
}

const META: Record<NudgeKind, { label: string; tone: string; icon: IconName; action: string }> = {
  overdue: { label: 'เลยกำหนด', tone: 'danger', icon: 'alert', action: 'เปิดงาน' },
  'must-start': { label: 'ต้องเริ่ม', tone: 'danger', icon: 'flag', action: 'ดึงเข้าวันนี้' },
  'follow-up': { label: 'ตามงาน', tone: 'info', icon: 'user', action: 'ร่างข้อความ' },
  stalled: { label: 'นิ่งอยู่', tone: 'warn', icon: 'clock', action: 'เปิดงาน' },
}

const FIRST = 5

/** สิ่งที่ต้องทำอะไรสักอย่างวันนี้ ลูปละหนึ่งเรื่อง พร้อมปุ่มจัดการ */
export function Attention({ nudges, onPull, onOpen }: Props) {
  const [showAll, setShowAll] = useState(false)
  const ids = useId()
  if (nudges.length === 0) return null
  const shown = showAll ? nudges : nudges.slice(0, FIRST)

  return (
    <section className="attention" aria-labelledby={`${ids}-h`}>
      <h2 id={`${ids}-h`}>
        สิ่งที่ต้องดู <span className="count">{nudges.length}</span>
      </h2>
      <ul>
        {shown.map((n) => {
          const meta = META[n.kind]
          return (
            <li key={n.loop.id} className={`att att-${meta.tone}`}>
              <span className="att-icon" aria-hidden="true">
                <Icon name={meta.icon} />
              </span>
              <span className="att-body">
                <span className="att-title">{n.loop.title}</span>
                <span className="att-text">
                  <span className="att-kind">{meta.label}</span> {n.text}
                </span>
              </span>
              <button type="button" onClick={() => (n.kind === 'must-start' ? onPull(n.loop) : onOpen(n.loop))}>
                {meta.action}
              </button>
            </li>
          )
        })}
      </ul>
      {nudges.length > FIRST && (
        <button type="button" className="ghost" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'แสดงน้อยลง' : `ดูอีก ${nudges.length - FIRST} เรื่อง`}
        </button>
      )}
    </section>
  )
}
