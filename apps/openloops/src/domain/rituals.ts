import type { PlannerSettings } from './capacity'
import { addDays, dateKeyOf, startOfWeek, toDateKey, weekDays, weekdayOf, type DateKey } from './dates'
import { compareOpen, isClosed, newStep, scheduleOn, setHorizon, setStatus, type Loop } from './loop'
import { FOLLOW_UP_GAP, addWorkdays, loopFlags } from './nudges'

// พิธีปิดวันและทบทวนสัปดาห์: ทุกลูปต้องมีการตัดสินใจอย่างตั้งใจ ไม่มีอะไรค้างไว้เฉย ๆ

/** เลื่อนมาแล้วกี่ครั้ง ตอนปิดวันถึงต้องถามตรง ๆ */
export const CHRONIC_ROLLOVERS = 2
/** เลื่อนมาแล้วกี่ครั้ง ถึงนับเป็นงานค้างตอนทบทวนสัปดาห์ */
export const REVIEW_ROLLOVERS = 3

export type Decision =
  | { kind: 'done' }
  | { kind: 'carry' }
  | { kind: 'keep' }
  | { kind: 'tray'; horizon: 'week' | 'later' }
  | { kind: 'schedule'; date: DateKey }
  | { kind: 'drop' }
  | { kind: 'split'; firstStep: string; carry: boolean }
  | { kind: 'delegate'; to: string }

export interface DecisionContext {
  now: Date
  /** วันทำงานถัดไป ที่ "ทำต่อ" จะยกงานไป */
  nextWorkday: DateKey
  workdays: number[]
}

export function isChronic(loop: Loop): boolean {
  return loop.rolloverCount >= CHRONIC_ROLLOVERS
}

export function decisionError(decision: Decision | null | undefined): string | null {
  if (!decision) return 'เลือกว่าจะทำอย่างไรกับงานนี้'
  if (decision.kind === 'split' && !decision.firstStep.trim()) return 'ใส่ขั้นแรกที่ทำได้ใน 15 นาที'
  if (decision.kind === 'delegate' && !decision.to.trim()) return 'ใส่ชื่อคนที่รับงานต่อ'
  return null
}

/** แทรกขั้นใหม่เป็นขั้นถัดไป คือก่อนขั้นแรกที่ยังไม่เสร็จ นับเป็นการขยับ ลูปจะได้ไม่ถูกมองว่านิ่ง */
export function insertNextStep(loop: Loop, title: string, now: Date): Loop {
  const step = newStep(title)
  const at = loop.steps.findIndex((s) => !s.doneAt)
  const steps = at === -1 ? [...loop.steps, step] : [...loop.steps.slice(0, at), step, ...loop.steps.slice(at)]
  const ts = now.toISOString()
  return { ...loop, steps, updatedAt: ts, lastProgressAt: ts }
}

export function applyDecision(loop: Loop, decision: Decision, ctx: DecisionContext): Loop {
  const { now } = ctx
  switch (decision.kind) {
    case 'done':
      return setStatus(loop, 'done', now)
    case 'drop':
      return setStatus(loop, 'dropped', now)
    case 'keep':
      return loop
    case 'carry':
      return scheduleOn(loop, ctx.nextWorkday, now)
    case 'schedule':
      return scheduleOn(loop, decision.date, now)
    case 'tray':
      return setHorizon(loop, decision.horizon, now)
    case 'split': {
      const split = insertNextStep(loop, decision.firstStep.trim(), now)
      return decision.carry ? scheduleOn(split, ctx.nextWorkday, now) : split
    }
    case 'delegate':
      return setStatus(loop, 'waiting', now, {
        waitingOn: decision.to.trim(),
        followUpDate: addWorkdays(toDateKey(now), FOLLOW_UP_GAP, ctx.workdays),
      })
  }
}

export type Decisions = Record<string, Decision | null | undefined>

/** ใช้การตัดสินใจกับลูปที่ยังเปิดอยู่ คืนทั้งผลลัพธ์ (ไว้แสดงตัวอย่าง) และคู่ก่อน/หลังของลูปที่เปลี่ยน (ไว้บันทึกและเลิกทำ) */
export function applyDecisions(
  loops: Loop[],
  decisions: Decisions,
  ctx: DecisionContext,
): { next: Loop[]; changed: Loop[]; previous: Loop[] } {
  const changed: Loop[] = []
  const previous: Loop[] = []
  const next = loops.map((loop) => {
    const decision = decisions[loop.id]
    if (!decision || isClosed(loop) || decisionError(decision)) return loop
    const result = applyDecision(loop, decision, ctx)
    if (result !== loop) {
      changed.push(result)
      previous.push(loop)
    }
    return result
  })
  return { next, changed, previous }
}

/** นับจำนวนการตัดสินใจแต่ละแบบ สำหรับหน้าสรุป */
export function countDecisions(loops: Loop[], decisions: Decisions): Partial<Record<Decision['kind'], number>> {
  const counts: Partial<Record<Decision['kind'], number>> = {}
  for (const loop of loops) {
    const decision = decisions[loop.id]
    if (!decision || isClosed(loop) || decisionError(decision)) continue
    counts[decision.kind] = (counts[decision.kind] ?? 0) + 1
  }
  return counts
}

// ---------- ปิดวัน ----------

/** งานที่ต้องตัดสินใจตอนปิดวัน: ลูปที่เปิดอยู่ในวันนี้ ยกเว้นที่รอคนอื่น */
export function shutdownCandidates(loops: Loop[]): Loop[] {
  return loops.filter((l) => !isClosed(l) && l.horizon === 'today' && l.status !== 'waiting').sort(compareOpen)
}

/** งานปกติยกไปวันถัดไปเป็นค่าเริ่มต้น งานที่เลื่อนซ้ำต้องเลือกเอง */
export function defaultShutdownDecision(loop: Loop): Decision | null {
  return isChronic(loop) ? null : { kind: 'carry' }
}

// ---------- ทบทวนสัปดาห์ ----------

export interface WeekSummary {
  done: Loop[]
  dropped: Loop[]
  /** เวลาประเมินรวมของงานที่เสร็จ */
  doneMinutes: number
  shutdownDays: number
  workdaysSoFar: number
  /** งานที่ยังเปิดและเลื่อนมาหลายครั้ง */
  chronic: Loop[]
}

export function weekSummary(
  loops: Loop[],
  today: DateKey,
  settings: PlannerSettings,
  shutdownDates: DateKey[],
): WeekSummary {
  const start = startOfWeek(today)
  const inWeek = (iso: string | null) => !!iso && dateKeyOf(iso) >= start && dateKeyOf(iso) <= today
  const closed = loops.filter((l) => isClosed(l) && inWeek(l.closedAt))
  const done = closed.filter((l) => l.status === 'done')
  const days = weekDays(start).filter((d) => d <= today)
  return {
    done,
    dropped: closed.filter((l) => l.status === 'dropped'),
    doneMinutes: done.reduce((sum, l) => sum + (l.estimateMinutes ?? 0), 0),
    shutdownDays: new Set(shutdownDates.filter((d) => d >= start && d <= today)).size,
    workdaysSoFar: days.filter((d) => settings.workdays.includes(weekdayOf(d))).length,
    chronic: loops.filter((l) => !isClosed(l) && l.rolloverCount >= REVIEW_ROLLOVERS).sort(compareOpen),
  }
}

export interface ReviewItem {
  loop: Loop
  reason: string
}

/** งานค้างที่ควรตัดสินใจตอนทบทวนสัปดาห์ พร้อมเหตุผลที่ยกขึ้นมา */
export function reviewCandidates(loops: Loop[], today: DateKey, settings: PlannerSettings): ReviewItem[] {
  const items: ReviewItem[] = []
  for (const loop of [...loops].sort(compareOpen)) {
    if (isClosed(loop) || loop.status === 'waiting') continue
    const flags = loopFlags(loop, today, settings)
    const reasons = [
      flags.overdueDays !== null ? `เลยกำหนด ${flags.overdueDays} วัน` : null,
      flags.stalledDays !== null ? `นิ่ง ${flags.stalledDays} วันทำการ` : null,
      loop.rolloverCount >= REVIEW_ROLLOVERS ? `เลื่อนมา ${loop.rolloverCount} ครั้ง` : null,
    ].filter((r): r is string => r !== null)
    if (reasons.length) items.push({ loop, reason: reasons.join(' · ') })
  }
  return items
}

/** งานในกองงานที่ยังไม่ได้ลงวัน ไว้วางแผนสัปดาห์ */
export function planCandidates(loops: Loop[], exclude: ReadonlySet<string>): Loop[] {
  return loops
    .filter((l) => !isClosed(l) && l.status !== 'waiting' && l.horizon !== 'today' && !l.plannedDate && !exclude.has(l.id))
    .sort((a, b) => (a.horizon === b.horizon ? compareOpen(a, b) : a.horizon === 'week' ? -1 : 1))
}

/** พฤหัสบดีเป็นต้นไปวางแผนสัปดาห์หน้า ก่อนหน้านั้นวางแผนสัปดาห์นี้ */
export function defaultTargetWeek(today: DateKey): DateKey {
  const day = weekdayOf(today)
  const start = startOfWeek(today)
  return day === 0 || day >= 4 ? addDays(start, 7) : start
}

/** วันทำงานของสัปดาห์เป้าหมายที่ยังลงงานได้ (ไม่รวมวันที่ผ่านไปแล้ว) */
export function plannableDays(weekStart: DateKey, today: DateKey, settings: PlannerSettings): DateKey[] {
  return weekDays(weekStart).filter((d) => d >= today && settings.workdays.includes(weekdayOf(d)))
}

/** ชวนทบทวนตั้งแต่วันทำงานสุดท้ายของสัปดาห์ ถ้ายังไม่ได้ทบทวนสัปดาห์นี้ */
export function reviewDue(today: DateKey, settings: PlannerSettings, reviewDates: DateKey[]): boolean {
  const start = startOfWeek(today)
  const workdays = weekDays(start).filter((d) => settings.workdays.includes(weekdayOf(d)))
  if (workdays.length === 0) return false
  const reviewed = reviewDates.some((d) => d >= start && d <= addDays(start, 6))
  return !reviewed && today >= workdays[workdays.length - 1]
}
