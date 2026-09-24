import { dateKeyOf, type DateKey } from './dates'
import { isClosed, progress, type Loop } from './loop'

// วางแผนตามเวลาว่างจริง ไม่ใช่ตามรายการที่อยากทำ

export interface PlannerSettings {
  workMinutes: number
  bufferMinutes: number
}

export const DEFAULT_SETTINGS: PlannerSettings = { workMinutes: 480, bufferMinutes: 60 }

/** สัดส่วนที่ถือว่าใกล้เต็ม */
export const TIGHT_RATIO = 0.85

export type LoadTone = 'empty' | 'ok' | 'tight' | 'over'

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

export function freeMinutes(settings: PlannerSettings, meetingMinutes: number): number {
  return Math.max(0, settings.workMinutes - meetingMinutes - settings.bufferMinutes)
}

export function computeDayLoad(
  loops: Loop[],
  today: DateKey,
  settings: PlannerSettings,
  meetingMinutes: number,
): DayLoad {
  const todays = loops.filter((l) => l.horizon === 'today' && !isClosed(l))
  const waiting = todays.filter((l) => l.status === 'waiting')
  const active = todays.filter((l) => l.status !== 'waiting')
  const counted = active.filter((l) => l.estimateMinutes !== null)
  const unestimated = active.filter((l) => l.estimateMinutes === null)
  const plannedMinutes = counted.reduce((sum, l) => sum + (remainingMinutes(l) ?? 0), 0)
  const free = freeMinutes(settings, meetingMinutes)
  const diffMinutes = free - plannedMinutes

  let tone: LoadTone
  if (plannedMinutes === 0) tone = 'empty'
  else if (plannedMinutes > free) tone = 'over'
  else if (plannedMinutes >= free * TIGHT_RATIO) tone = 'tight'
  else tone = 'ok'

  return {
    workMinutes: settings.workMinutes,
    meetingMinutes,
    bufferMinutes: settings.bufferMinutes,
    freeMinutes: free,
    plannedMinutes,
    diffMinutes,
    tone,
    counted,
    unestimated,
    waiting,
    carriedToday: todays.filter((l) => l.carriedOn === today).length,
    doneToday: loops.filter((l) => l.status === 'done' && l.closedAt && dateKeyOf(l.closedAt) === today).length,
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
