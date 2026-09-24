import { freeMinutes, isWorkday, remainingMinutes, type DayLoad, type Particle, type PlannerSettings } from './capacity'
import { addDays, dateKeyOf, daysBetween, formatMinutes, nextWorkday, toDateKey, weekdayOf, withDay, type DateKey } from './dates'
import { isClosed, progress, type Loop } from './loop'

// เตือนเฉพาะสิ่งที่ต้องทำอะไรสักอย่าง และเตือนตอนที่ยังแก้ทัน ไม่ใช่ตอนครบกำหนด

/** ไม่ขยับมากี่วันทำการถึงนับว่านิ่ง */
export const STALL_WORKDAYS = 3
/** งานชิ้นเดียวใช้เวลาว่างของวันได้ไม่เกินสัดส่วนนี้ เพราะมีงานอื่นแบ่งเวลาอยู่ด้วย */
export const DAY_SHARE = 0.5
/** กด "ตามแล้ว" แล้วเลื่อนวันตามงานไปกี่วันทำการ */
export const FOLLOW_UP_GAP = 3

export type NudgeKind = 'overdue' | 'must-start' | 'follow-up' | 'stalled'

export interface Nudge {
  kind: NudgeKind
  loop: Loop
  text: string
}

const PRIORITY: NudgeKind[] = ['overdue', 'must-start', 'follow-up', 'stalled']

/** จำนวนวันทำงานในช่วง (from, to] */
export function workdaysBetween(from: DateKey, to: DateKey, workdays: number[]): number {
  let count = 0
  // จำกัดรอบไว้ กันลูปที่ไม่ได้แตะมาหลายปี
  for (let d = addDays(from, 1), i = 0; d <= to && i < 400; d = addDays(d, 1), i++) {
    if (workdays.includes(weekdayOf(d))) count++
  }
  return count
}

/** วันทำงานถัดไปลำดับที่ n หลัง `from` */
export function addWorkdays(from: DateKey, n: number, workdays: number[]): DateKey {
  let d = from
  for (let i = 0; i < n; i++) d = nextWorkday(d, workdays)
  return d
}

/** วันสุดท้ายที่ต้องเริ่มงานถึงจะทันกำหนดส่ง นับถอยจากวันส่งเฉพาะวันทำงาน */
export function latestStart(loop: Loop, settings: PlannerSettings): DateKey | null {
  const left = remainingMinutes(loop)
  if (!loop.dueDate || !left || settings.workdays.length === 0) return null
  const perDay = Math.max(30, Math.floor(freeMinutes(settings, 0) * DAY_SHARE))
  let need = left
  let day = loop.dueDate
  for (let i = 0; i < 366; i++) {
    if (isWorkday(day, settings)) {
      need -= perDay
      if (need <= 0) return day
    }
    day = addDays(day, -1)
  }
  return day
}

export interface LoopFlags {
  overdueDays: number | null
  /** วันที่ควรเริ่ม ถ้าถึงหรือเลยแล้ว */
  mustStartSince: DateKey | null
  followUpDue: boolean
  stalledDays: number | null
}

export function loopFlags(loop: Loop, today: DateKey, settings: PlannerSettings): LoopFlags {
  const none: LoopFlags = { overdueDays: null, mustStartSince: null, followUpDue: false, stalledDays: null }
  if (isClosed(loop)) return none
  const overdue = loop.dueDate !== null && loop.dueDate < today
  const start = !overdue && loop.status !== 'waiting' ? latestStart(loop, settings) : null
  const idle =
    (loop.status === 'active' || loop.status === 'blocked') && loop.horizon !== 'later'
      ? workdaysBetween(dateKeyOf(loop.lastProgressAt), today, settings.workdays)
      : 0
  return {
    overdueDays: overdue ? daysBetween(loop.dueDate!, today) : null,
    mustStartSince: start && today >= start ? start : null,
    followUpDue: loop.status === 'waiting' && loop.followUpDate !== null && loop.followUpDate <= today,
    stalledDays: idle >= STALL_WORKDAYS ? idle : null,
  }
}

function describe(kind: NudgeKind, loop: Loop, flags: LoopFlags, today: DateKey): string {
  switch (kind) {
    case 'overdue':
      return `เลยกำหนดส่งมา ${flags.overdueDays} วัน`
    case 'must-start': {
      const left = formatMinutes(remainingMinutes(loop) ?? 0)
      const when =
        flags.mustStartSince === today ? 'ต้องเริ่มวันนี้' : withDay('ควรเริ่มตั้งแต่', flags.mustStartSince!, today)
      return `${withDay('ส่ง', loop.dueDate!, today)} เหลือ ${left} · ${when}`
    }
    case 'follow-up': {
      const late = daysBetween(loop.followUpDate!, today)
      return late === 0 ? `ถึงวันตามงานกับ ${loop.waitingOn}` : `เลยวันตามงานกับ ${loop.waitingOn} มา ${late} วัน`
    }
    case 'stalled': {
      const { done, total } = progress(loop)
      const where = total > 0 ? ` · ค้างที่ขั้น ${Math.min(done + 1, total)}/${total}` : ''
      return `${loop.status === 'blocked' ? 'ติดขัด' : 'ไม่ขยับ'}มา ${flags.stalledDays} วันทำการ${where}`
    }
  }
}

/**
 * สิ่งที่ต้องดูวันนี้ ลูปละหนึ่งเรื่องที่สำคัญที่สุด
 * "ต้องเริ่ม" นับเฉพาะลูปที่ยังไม่อยู่ในวันนี้ เพราะลูปในวันนี้อยู่ในแผนแล้ว
 */
export function nudgesFor(loops: Loop[], today: DateKey, settings: PlannerSettings): Nudge[] {
  const nudges: Nudge[] = []
  for (const loop of loops) {
    const flags = loopFlags(loop, today, settings)
    const kinds: Record<NudgeKind, boolean> = {
      overdue: flags.overdueDays !== null,
      'must-start': flags.mustStartSince !== null && loop.horizon !== 'today',
      'follow-up': flags.followUpDue,
      stalled: flags.stalledDays !== null,
    }
    const kind = PRIORITY.find((k) => kinds[k])
    if (kind) nudges.push({ kind, loop, text: describe(kind, loop, flags, today) })
  }
  return nudges.sort(
    (a, b) =>
      PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind) ||
      (a.loop.dueDate ?? '9999-12-31').localeCompare(b.loop.dueDate ?? '9999-12-31'),
  )
}

/** ร่างข้อความตามงาน ผู้ใช้คัดลอกไปส่งเอง แอปไม่ส่งให้ */
export function followUpMessage(loop: Loop, today: DateKey, particle: Particle): string {
  const who = loop.waitingOn ?? ''
  const due = loop.dueDate ? ` เพราะงานนี้${withDay('ต้องส่ง', loop.dueDate, today)}` : ''
  return [
    `สวัสดี${particle} ${who}`.trim(),
    `ขอติดตามเรื่อง "${loop.title}"${particle} ไม่ทราบว่าตอนนี้ความคืบหน้าเป็นอย่างไรบ้าง${due}`,
    `ขอบคุณ${particle}`,
  ].join('\n')
}

/** ตามงานแล้ว: เลื่อนวันตามงานถัดไป และนับเป็นความคืบหน้า ลูปจะได้ไม่ถูกมองว่านิ่ง */
export function markFollowedUp(loop: Loop, now: Date, workdays: number[]): Loop {
  const ts = now.toISOString()
  return {
    ...loop,
    followUpDate: addWorkdays(toDateKey(now), FOLLOW_UP_GAP, workdays),
    lastProgressAt: ts,
    updatedAt: ts,
  }
}

// ---------- แจ้งเตือนบนเครื่อง ----------

export type NotifyKind = 'brief' | 'shutdown'

/** ช่วงเตือนใกล้เลิกงาน: 30 นาทีก่อนเลิกงาน ถึง 2 ชม. หลังเลิกงาน */
const SHUTDOWN_BEFORE = 30
const SHUTDOWN_AFTER = 120

/** แจ้งเตือนที่ถึงเวลาส่งและยังไม่ได้ส่งวันนี้ */
export function pendingNotifications(
  now: Date,
  settings: PlannerSettings,
  sent: Partial<Record<NotifyKind, string>>,
): NotifyKind[] {
  if (!settings.notify || !isWorkday(toDateKey(now), settings)) return []
  const minute = now.getHours() * 60 + now.getMinutes()
  const end = settings.startMinutes + settings.workMinutes
  const pending: NotifyKind[] = []
  if (!sent.brief && minute >= settings.startMinutes && minute < end - SHUTDOWN_BEFORE) pending.push('brief')
  if (!sent.shutdown && minute >= end - SHUTDOWN_BEFORE && minute < end + SHUTDOWN_AFTER) pending.push('shutdown')
  return pending
}

export interface NotifyMessage {
  title: string
  body: string
}

export function briefMessage(load: DayLoad, nudges: Nudge[]): NotifyMessage {
  const count = (k: NudgeKind) => nudges.filter((n) => n.kind === k).length
  const parts = [
    load.plannedMinutes > 0
      ? `วางงานไว้ ${formatMinutes(load.plannedMinutes)} จากเวลาว่าง ${formatMinutes(load.freeMinutes)}${load.tone === 'over' ? ' (เกิน)' : ''}`
      : 'ยังไม่มีงานที่ประเมินเวลาในวันนี้',
  ]
  const labels: [NudgeKind, string][] = [
    ['overdue', 'เลยกำหนด'],
    ['must-start', 'ต้องเริ่ม'],
    ['follow-up', 'ต้องตามงาน'],
    ['stalled', 'นิ่งอยู่'],
  ]
  for (const [kind, label] of labels) if (count(kind) > 0) parts.push(`${label} ${count(kind)}`)
  return { title: 'แผนวันนี้ · OpenLoops', body: parts.join(' · ') }
}

export function shutdownMessage(openToday: number): NotifyMessage {
  return {
    title: 'ใกล้เลิกงานแล้ว',
    body:
      openToday > 0
        ? `วันนี้ยังเปิดอยู่ ${openToday} งาน ปิด เลื่อน หรือยกไปวันถัดไปให้เรียบร้อยก่อนเลิกงาน`
        : 'ปิดงานของวันนี้ครบแล้ว เลิกงานได้เลย',
  }
}

export function formatClock(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
