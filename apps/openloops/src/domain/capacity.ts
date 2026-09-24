import { dateKeyOf, weekDays, weekdayOf, type DateKey } from './dates'
import { compareOpen, isClosed, progress, type Loop } from './loop'

// วางแผนตามเวลาว่างจริง ไม่ใช่ตามรายการที่อยากทำ

export interface PlannerSettings {
  workMinutes: number
  bufferMinutes: number
  /** วันทำงาน 0 = อาทิตย์ ... 6 = เสาร์ */
  workdays: number[]
  /** เวลาเริ่มงาน นาทีนับจากเที่ยงคืน ใช้กำหนดเวลาแจ้งเตือน */
  startMinutes: number
  /** แจ้งเตือนบนเครื่อง ปิดไว้จนกว่าผู้ใช้จะเปิดเอง */
  notify: boolean
  /** คำลงท้ายในข้อความตามงาน */
  particle: Particle
}

export type Particle = '' | 'ครับ' | 'ค่ะ'

export const DEFAULT_WORKDAYS = [1, 2, 3, 4, 5]

export const DEFAULT_SETTINGS: PlannerSettings = {
  workMinutes: 480,
  bufferMinutes: 60,
  workdays: DEFAULT_WORKDAYS,
  startMinutes: 9 * 60,
  notify: false,
  particle: '',
}

/** สัดส่วนที่ถือว่าใกล้เต็ม */
export const TIGHT_RATIO = 0.85

/** off = วันหยุด: เวลาว่างเป็น 0 แต่ไม่ถือว่าเกิน */
export type LoadTone = 'empty' | 'ok' | 'tight' | 'over' | 'off'

export interface DayLoad {
  workMinutes: number
  meetingMinutes: number
  bufferMinutes: number
  freeMinutes: number
  plannedMinutes: number
  /** เวลาว่าง − เวลาที่วางไว้: บวกคือเหลือ ลบคือเกิน */
  diffMinutes: number
  tone: LoadTone
  /** ลูปที่นับเวลาแล้ว */
  counted: Loop[]
  /** ลูปที่ยังไม่ได้ประเมินเวลา จึงยังไม่ถูกนับ */
  unestimated: Loop[]
  waiting: Loop[]
  carriedToday: number
  doneToday: number
}

/** เวลาที่เหลือของลูป คิดตามสัดส่วนขั้นที่ยังไม่เสร็จ */
export function remainingMinutes(loop: Loop): number | null {
  if (loop.estimateMinutes === null) return null
  const { done, total } = progress(loop)
  if (total === 0) return loop.estimateMinutes
  return Math.round((loop.estimateMinutes * (total - done)) / total)
}

export function freeMinutes(settings: Pick<PlannerSettings, 'workMinutes' | 'bufferMinutes'>, meetingMinutes: number): number {
  return Math.max(0, settings.workMinutes - meetingMinutes - settings.bufferMinutes)
}

export function isWorkday(date: DateKey, settings: PlannerSettings): boolean {
  return settings.workdays.includes(weekdayOf(date))
}

/** ลูปที่เปิดอยู่และวางไว้ทำในวัน `date`: วันนี้ดูกลุ่มวันนี้, วันหลังดูวันที่ลงไว้, วันที่ผ่านไปแล้วไม่มี */
export function loopsOnDay(loops: Loop[], date: DateKey, today: DateKey): Loop[] {
  if (date < today) return []
  return loops
    .filter((l) => !isClosed(l) && (date === today ? l.horizon === 'today' : l.horizon !== 'today' && l.plannedDate === date))
    .sort(compareOpen)
}

export function loadForDay(
  loops: Loop[],
  date: DateKey,
  today: DateKey,
  settings: PlannerSettings,
  meetingMinutes: number,
): DayLoad {
  const onDay = loopsOnDay(loops, date, today)
  const waiting = onDay.filter((l) => l.status === 'waiting')
  const active = onDay.filter((l) => l.status !== 'waiting')
  const counted = active.filter((l) => l.estimateMinutes !== null)
  const unestimated = active.filter((l) => l.estimateMinutes === null)
  const plannedMinutes = counted.reduce((sum, l) => sum + (remainingMinutes(l) ?? 0), 0)
  const working = isWorkday(date, settings)
  const workMinutes = working ? settings.workMinutes : 0
  const bufferMinutes = working ? settings.bufferMinutes : 0
  const free = freeMinutes({ workMinutes, bufferMinutes }, meetingMinutes)
  const diffMinutes = free - plannedMinutes

  let tone: LoadTone
  if (!working) tone = 'off'
  else if (plannedMinutes === 0) tone = 'empty'
  else if (plannedMinutes > free) tone = 'over'
  else if (plannedMinutes >= free * TIGHT_RATIO) tone = 'tight'
  else tone = 'ok'

  return {
    workMinutes,
    meetingMinutes,
    bufferMinutes,
    freeMinutes: free,
    plannedMinutes,
    diffMinutes,
    tone,
    counted,
    unestimated,
    waiting,
    carriedToday: onDay.filter((l) => l.carriedOn === date).length,
    doneToday: loops.filter((l) => l.status === 'done' && l.closedAt && dateKeyOf(l.closedAt) === date).length,
  }
}

export function computeDayLoad(loops: Loop[], today: DateKey, settings: PlannerSettings, meetingMinutes: number): DayLoad {
  return loadForDay(loops, today, today, settings, meetingMinutes)
}

export interface DayColumn {
  date: DateKey
  isPast: boolean
  isToday: boolean
  isWorkday: boolean
  loops: Loop[]
  load: DayLoad
}

export interface WeekPlan {
  days: DayColumn[]
  /** ลูปที่ยังไม่ได้ลงวัน */
  tray: { week: Loop[]; later: Loop[] }
  /** รวมเฉพาะวันนี้เป็นต้นไป เพราะวันที่ผ่านไปแล้ววางงานเพิ่มไม่ได้ */
  plannedMinutes: number
  freeMinutes: number
}

export function buildWeek(
  loops: Loop[],
  weekStart: DateKey,
  today: DateKey,
  settings: PlannerSettings,
  meetings: Record<DateKey, number>,
): WeekPlan {
  const days = weekDays(weekStart).map((date) => {
    const load = loadForDay(loops, date, today, settings, meetings[date] ?? 0)
    return {
      date,
      isPast: date < today,
      isToday: date === today,
      isWorkday: isWorkday(date, settings),
      loops: loopsOnDay(loops, date, today),
      load,
    }
  })
  const unscheduled = loops.filter((l) => !isClosed(l) && l.horizon !== 'today' && !l.plannedDate).sort(compareOpen)
  const upcoming = days.filter((d) => !d.isPast)
  return {
    days,
    tray: { week: unscheduled.filter((l) => l.horizon === 'week'), later: unscheduled.filter((l) => l.horizon === 'later') },
    plannedMinutes: upcoming.reduce((sum, d) => sum + d.load.plannedMinutes, 0),
    freeMinutes: upcoming.reduce((sum, d) => sum + d.load.freeMinutes, 0),
  }
}

function isUrgent(loop: Loop, today: DateKey): boolean {
  return loop.dueDate !== null && loop.dueDate <= today
}

/**
 * ลูปที่ควรเลื่อนออกจากวันนี้ให้พอดีเวลาว่าง
 * - ไม่แตะลูปที่ส่งวันนี้หรือเลยกำหนด
 * - ไล่จากลูปที่ยืดหยุ่นที่สุดก่อน: ไม่มีกำหนดส่ง แล้วจึงส่งไกลสุด
 * - ในกลุ่มกำหนดส่งเดียวกัน ถ้ามีลูปเดียวที่ครอบคลุมส่วนที่เหลือได้ ให้เลือกตัวเล็กสุดที่พอ
 *   ไม่เช่นนั้นเลือกตัวใหญ่สุด เพื่อให้เลื่อนน้อยชิ้นและไม่เลื่อนเกินจำเป็น
 */
export function suggestPostpone(counted: Loop[], overMinutes: number, today: DateKey): Loop[] {
  const size = (l: Loop) => remainingMinutes(l) ?? 0
  const dueKey = (l: Loop) => l.dueDate ?? '9999-12-31'
  const pool = counted.filter((l) => !isUrgent(l, today) && size(l) > 0)
  const picked: Loop[] = []
  let left = overMinutes
  while (left > 0 && pool.length) {
    const mostFlexible = pool.reduce((a, b) => (dueKey(b) > dueKey(a) ? b : a))
    const tier = pool.filter((l) => dueKey(l) === dueKey(mostFlexible))
    const covering = tier.filter((l) => size(l) >= left)
    const choice = covering.length
      ? covering.reduce((a, b) => (size(b) < size(a) ? b : a))
      : tier.reduce((a, b) => (size(b) > size(a) ? b : a))
    picked.push(choice)
    pool.splice(pool.indexOf(choice), 1)
    left -= size(choice)
  }
  return picked
}
