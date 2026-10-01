import { useId, useRef, useState, type FormEvent } from 'react'
import { dateKeyOf, daysBetween, formatDay, formatLongDay, startOfWeek, withDay, type DateKey } from '../domain/dates'
import { progress, type Loop } from '../domain/loop'
import { formatClock } from '../domain/nudges'
import {
  PLAN_LABEL,
  TAB_LABEL,
  doneSince,
  dueOptions,
  historyDays,
  itemBadges,
  startOfMonth,
  tabItems,
  tabOf,
  validateTitle,
  type SimpleValues,
  type Tab,
} from '../domain/simple'
import { Chips } from './Chips'

export type SimpleViewName = Tab | 'history'

interface Props {
  loops: Loop[]
  today: DateKey
  view: SimpleViewName
  onAdd: (values: SimpleValues) => void
  onToggle: (loop: Loop) => void
  onOpen: (loop: Loop) => void
}

const LINKS: [SimpleViewName, string, string][] = [
  ['today', '#', 'วันนี้'],
  ['week', '#week', 'สัปดาห์นี้'],
  ['month', '#month', 'เดือนนี้'],
  ['history', '#history', 'ย้อนดู'],
]

const HISTORY_PAGE = 14

const clockOf = (iso: string) => {
  const d = new Date(iso)
  return formatClock(d.getHours() * 60 + d.getMinutes())
}

/** โหมดง่าย: รายการงานแบ่งแท็บ ติ๊กแล้วจางลงอยู่ท้ายรายการ และย้อนดูงานที่ทำเสร็จรายวัน */
export function SimpleView({ loops, today, view, onAdd, onToggle, onOpen }: Props) {
  const openCount = (tab: Tab) => tabItems(loops, tab, today).open.length
  return (
    <div className="simple">
      <nav className="stabs" aria-label="รายการงาน">
        {LINKS.map(([name, href, label]) => {
          const count = name === 'history' ? 0 : openCount(name)
          return (
            <a key={name} href={href} aria-current={view === name ? 'page' : undefined}>
              {label}
              {count > 0 && <span className="count">{count}</span>}
            </a>
          )
        })}
      </nav>
      {view === 'history' ? (
        <History loops={loops} today={today} onToggle={onToggle} onOpen={onOpen} />
      ) : (
        <TabList key={view} loops={loops} tab={view} today={today} onAdd={onAdd} onToggle={onToggle} onOpen={onOpen} />
      )}
    </div>
  )
}

function TabList({
  loops,
  tab,
  today,
  onAdd,
  onToggle,
  onOpen,
}: { loops: Loop[]; tab: Tab; today: DateKey } & Pick<Props, 'onAdd' | 'onToggle' | 'onOpen'>) {
  const ids = useId()
  const { open, done } = tabItems(loops, tab, today)
  const empty =
    done.length > 0 ? `ทำครบทุกงานใน${TAB_LABEL[tab]}แล้ว` : `ยังไม่มีงานใน${TAB_LABEL[tab]} พิมพ์ด้านบนแล้วกด Enter`
  return (
    <section className="tab-list" aria-labelledby={`${ids}-h`}>
      <h2 id={`${ids}-h`} className="sr-only">
        งาน{TAB_LABEL[tab]}
      </h2>
      <QuickAdd tab={tab} today={today} onAdd={onAdd} />
      {open.length > 0 ? (
        <ul className="tasks">
          {open.map((loop) => (
            <TaskRow key={loop.id} loop={loop} tab={tab} today={today} onToggle={onToggle} onOpen={onOpen} />
          ))}
        </ul>
      ) : (
        <p className="section-empty">{empty}</p>
      )}
      {done.length > 0 && (
        <>
          <h3 className="done-head">ทำแล้ว {done.length}</h3>
          <ul className="tasks">
            {done.map((loop) => (
              <TaskRow key={loop.id} loop={loop} tab={tab} today={today} onToggle={onToggle} onOpen={onOpen} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function QuickAdd({ tab, today, onAdd }: { tab: Tab; today: DateKey; onAdd: Props['onAdd'] }) {
  const ids = useId()
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState<DateKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const dues = dueOptions(today)

  function submit(e: FormEvent) {
    e.preventDefault()
    const found = validateTitle(title)
    setError(found)
    if (!found) {
      onAdd({ title, tab, dueDate })
      setTitle('')
      setDueDate(null)
    }
    input.current?.focus()
  }

  return (
    <form className="quick-add" onSubmit={submit} noValidate>
      <div className="inline-add">
        <label className="sr-only" htmlFor={`${ids}-title`}>
          เพิ่มงาน{TAB_LABEL[tab]}
        </label>
        <input
          id={`${ids}-title`}
          ref={input}
          data-quick-add
          placeholder={`เพิ่มงาน${TAB_LABEL[tab]} แล้วกด Enter`}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            setError(null)
          }}
          aria-invalid={!!error}
          autoComplete="off"
        />
        <button type="submit" className="primary">
          เพิ่ม
        </button>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="due-row">
        <span className="field-label">เสร็จภายใน</span>
        <Chips label="เสร็จภายใน" options={dues} value={dueDate} onChange={setDueDate}>
          <input
            type="date"
            className="chip chip-date"
            aria-label="เลือกวันที่จะเสร็จเอง"
            value={dueDate ?? ''}
            data-custom={dueDate !== null && !dues.some((o) => o.value === dueDate)}
            onChange={(e) => setDueDate(e.target.value || null)}
          />
        </Chips>
      </div>
    </form>
  )
}

function TaskRow({
  loop,
  tab,
  today,
  timeOnly = false,
  onToggle,
  onOpen,
}: {
  loop: Loop
  tab: Tab
  today: DateKey
  timeOnly?: boolean
  onToggle: Props['onToggle']
  onOpen: Props['onOpen']
}) {
  const done = loop.status === 'done'
  const badges = itemBadges(loop, tab, today)
  const steps = progress(loop)
  const doneText =
    done && loop.closedAt
      ? timeOnly
        ? `เสร็จ ${clockOf(loop.closedAt)}`
        : `${withDay('เสร็จ', dateKeyOf(loop.closedAt), today)} ${clockOf(loop.closedAt)}`
      : null
  return (
    <li className="task" data-done={done}>
      <input
        type="checkbox"
        className="task-check"
        checked={done}
        onChange={() => onToggle(loop)}
        aria-label={done ? `ยังไม่เสร็จ: ${loop.title}` : `เสร็จแล้ว: ${loop.title}`}
      />
      <button type="button" className="task-main" onClick={() => onOpen(loop)}>
        <span className="task-title">{loop.title}</span>
        {(doneText || badges.length > 0 || steps.total > 0) && (
          <span className="task-meta">
            {doneText && <span className="tag tag-muted">{doneText}</span>}
            {timeOnly && <span className="tag tag-muted">{PLAN_LABEL[tabOf(loop)]}</span>}
            {badges.map((b) => (
              <span key={b.text} className={`tag tag-${b.tone}`}>
                {b.text}
              </span>
            ))}
            {steps.total > 0 && !done && (
              <span className="tag tag-muted">
                ขั้น {steps.done}/{steps.total}
              </span>
            )}
          </span>
        )}
      </button>
    </li>
  )
}

function History({ loops, today, onToggle, onOpen }: { loops: Loop[]; today: DateKey } & Pick<Props, 'onToggle' | 'onOpen'>) {
  const [pages, setPages] = useState(1)
  const days = historyDays(loops, pages * HISTORY_PAGE)
  const more = historyDays(loops, pages * HISTORY_PAGE + 1).length > days.length
  const dayTitle = (date: DateKey) => (Math.abs(daysBetween(today, date)) <= 1 ? formatDay(date, today) : formatLongDay(date))
  return (
    <section className="history" aria-label="ย้อนดูงานที่ทำเสร็จ">
      <p className="summary">
        สัปดาห์นี้ทำเสร็จ <strong>{doneSince(loops, startOfWeek(today))}</strong> งาน · เดือนนี้{' '}
        <strong>{doneSince(loops, startOfMonth(today))}</strong> งาน
      </p>
      {days.length === 0 && <p className="section-empty">ยังไม่มีงานที่ทำเสร็จ ติ๊กงานในแท็บวันนี้แล้วจะมาอยู่ตรงนี้</p>}
      {days.map((day) => (
        <div key={day.date} className="history-day">
          <h3>
            {dayTitle(day.date)} <span className="count">{day.items.length}</span>
          </h3>
          <ul className="tasks">
            {day.items.map((loop) => (
              <TaskRow key={loop.id} loop={loop} tab={tabOf(loop)} today={today} timeOnly onToggle={onToggle} onOpen={onOpen} />
            ))}
          </ul>
        </div>
      ))}
      {more && (
        <button type="button" className="ghost" onClick={() => setPages(pages + 1)}>
          ดูย้อนหลังเพิ่ม
        </button>
      )}
    </section>
  )
}
