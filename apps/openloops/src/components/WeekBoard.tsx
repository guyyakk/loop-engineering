import { useState, type DragEvent } from 'react'
import { remainingMinutes, type DayColumn, type PlannerSettings, type WeekPlan } from '../domain/capacity'
import {
  WEEKDAY_SHORT,
  dueTone,
  formatLongDay,
  formatMinutes,
  formatWeekRange,
  fromDateKey,
  weekdayOf,
  withDay,
  type DateKey,
} from '../domain/dates'
import { progress, type Loop, type PlanValue } from '../domain/loop'
import { loopFlags } from '../domain/nudges'
import { Chips } from './Chips'
import { Icon } from './Icon'
import { Dots, FlagBadges, rolloverLabel } from './LoopCard'
import { CapacityBar, MEETINGS, meetingLabel } from './TodayPanel'

interface Props {
  plan: WeekPlan
  today: DateKey
  settings: PlannerSettings
  weekStart: DateKey
  weekOffset: number
  onWeekOffset: (offset: number) => void
  onOpen: (loop: Loop) => void
  onMove: (loop: Loop, target: PlanValue) => void
  onMeetingChange: (date: DateKey, minutes: number) => void
  onReview: () => void
}

function weekTitle(offset: number): string {
  if (offset === 0) return 'สัปดาห์นี้'
  if (offset === 1) return 'สัปดาห์หน้า'
  return `อีก ${offset} สัปดาห์`
}

function BoardCard({
  loop,
  today,
  settings,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  loop: Loop
  today: DateKey
  settings: PlannerSettings
  onOpen: (loop: Loop) => void
  onDragStart: (id: string) => void
  onDragEnd: () => void
}) {
  const { done, total } = progress(loop)
  const left = remainingMinutes(loop)
  const rollover = rolloverLabel(loop, today)
  const flags = loopFlags(loop, today, settings)
  const flagged = flags.mustStartSince !== null || flags.followUpDue || flags.stalledDays !== null
  return (
    <div
      className={`bcard status-${loop.status}`}
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', loop.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(loop.id)
      }}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(loop)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(loop)
        }
      }}
    >
      <span className="bcard-title">{loop.title}</span>
      <span className="bcard-meta">
        {total > 0 && (
          <span>
            <Dots done={done} total={total} /> {done}/{total}
          </span>
        )}
        {left !== null ? <span>{formatMinutes(left)}</span> : <span className="muted">ไม่ระบุเวลา</span>}
      </span>
      {(loop.dueDate || loop.status === 'waiting' || loop.status === 'blocked' || rollover || flagged) && (
        <span className="bcard-badges">
          {loop.status === 'waiting' && <span className="badge tone-info">รอ {loop.waitingOn}</span>}
          {loop.status === 'blocked' && <span className="badge tone-danger">ติดขัด</span>}
          {loop.dueDate && <span className={`badge due-${dueTone(loop.dueDate, today)}`}>{withDay('ส่ง', loop.dueDate, today)}</span>}
          {rollover && <span className={`badge ${loop.rolloverCount >= 3 ? 'tone-warn' : ''}`}>{rollover}</span>}
          <FlagBadges flags={flags} today={today} blocked={loop.status === 'blocked'} />
        </span>
      )}
    </div>
  )
}

export function WeekBoard({
  plan,
  today,
  settings,
  weekStart,
  weekOffset,
  onWeekOffset,
  onOpen,
  onMove,
  onMeetingChange,
  onReview,
}: Props) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<PlanValue | null>(null)
  const [meetingDay, setMeetingDay] = useState<DateKey | null>(null)
  const all = [...plan.days.flatMap((d) => d.loops), ...plan.tray.week, ...plan.tray.later]

  function dropZone(target: PlanValue, enabled: boolean) {
    if (!enabled) return {}
    // รับการวางตั้งแต่ dragenter ไม่ต้องรอ dragover ถัดไป ลากเร็วแล้วปล่อยทันทีก็ยังวางได้
    const accept = (e: DragEvent) => {
      if (!dragId) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (over !== target) setOver(target)
    }
    return {
      'data-over': over === target,
      onDragEnter: accept,
      onDragOver: accept,
      onDragLeave: (e: DragEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((t) => (t === target ? null : t))
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        const id = e.dataTransfer.getData('text/plain') || dragId
        const loop = all.find((l) => l.id === id)
        setOver(null)
        setDragId(null)
        if (loop) onMove(loop, target)
      },
    }
  }

  const cardProps = {
    today,
    settings,
    onOpen,
    onDragStart: setDragId,
    onDragEnd: () => {
      setDragId(null)
      setOver(null)
    },
  }

  const weekTone = plan.plannedMinutes > plan.freeMinutes ? 'over' : 'ok'
  // วันที่ผ่านไปแล้วและวันหยุดใช้คอลัมน์แคบ ให้วันที่ยังวางงานได้มีที่มากขึ้น
  const columns = plan.days.map((d) => (d.isWorkday && !d.isPast ? 'minmax(0, 1fr)' : 'minmax(0, 0.55fr)')).join(' ')

  // ใช้ฟังก์ชัน render ธรรมดา ไม่ใช่ component ซ้อน เพื่อไม่ให้การ์ด remount ระหว่างลาก
  function renderDay(day: DayColumn) {
    const { date, load } = day
    const label = day.isWorkday
      ? `${formatMinutes(load.plannedMinutes)} / ${formatMinutes(load.freeMinutes)}`
      : load.plannedMinutes > 0
        ? `วันหยุด · ${formatMinutes(load.plannedMinutes)}`
        : 'วันหยุด'
    return (
      <section
        key={date}
        className={`day tone-${load.tone}`}
        data-today={day.isToday}
        data-past={day.isPast}
        data-off={!day.isWorkday}
        aria-label={formatLongDay(date)}
        {...dropZone(date, !day.isPast)}
      >
        <header className="day-head">
          <div className="day-name">
            <span>{WEEKDAY_SHORT[weekdayOf(date)]}</span>
            <strong>{fromDateKey(date).getDate()}</strong>
            {day.isToday && <span className="today-tag">วันนี้</span>}
          </div>
          {!day.isPast && (
            <>
              <button
                type="button"
                className="day-load"
                aria-expanded={meetingDay === date}
                aria-label={`${label} ตั้งเวลาประชุม ${formatLongDay(date)}`}
                onClick={() => setMeetingDay((d) => (d === date ? null : date))}
              >
                {label}
              </button>
              <CapacityBar load={load} label={label} compact />
            </>
          )}
        </header>
        {meetingDay === date && (
          <div className="day-meeting">
            <span className="field-label">
              {meetingLabel(load)}
              {load.calendarMinutes !== null && <span className="muted"> ปฏิทินไม่ว่าง {formatMinutes(load.calendarMinutes)}</span>}
            </span>
            <Chips
              label={`${meetingLabel(load)} ${formatLongDay(date)}`}
              options={MEETINGS}
              value={load.meetingMinutes}
              onChange={(m) => onMeetingChange(date, m)}
            />
          </div>
        )}
        <div className="day-list">
          {day.loops.map((loop) => (
            <BoardCard key={loop.id} loop={loop} {...cardProps} />
          ))}
        </div>
        {load.doneToday > 0 && (
          <p className="day-done">
            <Icon name="check" size={12} /> ปิดแล้ว {load.doneToday} งาน
          </p>
        )}
      </section>
    )
  }

  function renderBucket(target: 'week' | 'later', title: string, loops: Loop[], hint: string) {
    return (
      <section className="bucket" aria-label={title} {...dropZone(target, true)}>
        <h3>
          {title} <span className="count">{loops.length}</span>
        </h3>
        <div className="day-list">
          {loops.map((loop) => (
            <BoardCard key={loop.id} loop={loop} {...cardProps} />
          ))}
          {loops.length === 0 && <p className="bucket-empty">{hint}</p>}
        </div>
      </section>
    )
  }

  return (
    <div className="week">
      <div className="week-head">
        <div className="week-nav">
          {weekOffset > 0 && (
            <button type="button" className="ghost" aria-label="สัปดาห์ก่อนหน้า" onClick={() => onWeekOffset(weekOffset - 1)}>
              <Icon name="chevron" size={18} />
            </button>
          )}
          <h2>
            {weekTitle(weekOffset)} <span className="muted">{formatWeekRange(weekStart)}</span>
          </h2>
          <button type="button" className="ghost next" aria-label="สัปดาห์ถัดไป" onClick={() => onWeekOffset(weekOffset + 1)}>
            <Icon name="chevron" size={18} />
          </button>
        </div>
        <button type="button" className="week-review" onClick={onReview}>
          <Icon name="repeat" /> ทบทวนสัปดาห์
        </button>
        <p className={`week-sum tone-${weekTone}`}>
          วางงานไว้ <strong>{formatMinutes(plan.plannedMinutes)}</strong> จากเวลาว่าง {formatMinutes(plan.freeMinutes)}
          <span className="muted"> {weekOffset === 0 ? '(วันนี้ถึงอาทิตย์)' : '(ทั้งสัปดาห์)'}</span>
        </p>
      </div>
      <p className="week-hint muted">ลากการ์ดไปวางที่วัน หรือกดการ์ดแล้วเลือกวัน</p>

      <div className="board">
        <div className="days" style={{ ['--cols' as string]: columns }}>
          {plan.days.map(renderDay)}
        </div>
        <aside className="tray">
          {renderBucket('week', 'สัปดาห์นี้ ยังไม่ลงวัน', plan.tray.week, 'ลากงานมาวางที่นี่เพื่อถอดออกจากวัน')}
          {renderBucket('later', 'ไว้ก่อน', plan.tray.later, 'งานที่ยังไม่ต้องทำสัปดาห์นี้')}
        </aside>
      </div>
    </div>
  )
}
