import { addDays, startOfWeek, toDateKey, weekdayOf, type DateKey } from './dates'

// "ลูป" คืองานหนึ่งชิ้นที่อาจมีหลายขั้น ลูปจะไม่หายไปเอง
// ต้องจบด้วยสถานะ done หรือ dropped อย่างตั้งใจเท่านั้น

export type LoopStatus = 'active' | 'waiting' | 'blocked' | 'done' | 'dropped'
export type Horizon = 'today' | 'week' | 'later'
export type Energy = 'deep' | 'shallow'

export interface Step {
  id: string
  title: string
  doneAt: string | null
}

export interface Loop {
  id: string
  title: string
  project: string | null
  steps: Step[]
  status: LoopStatus
  horizon: Horizon
  energy: Energy | null
  dueDate: DateKey | null
  estimateMinutes: number | null
  waitingOn: string | null
  followUpDate: DateKey | null
  createdAt: string
  updatedAt: string
  lastProgressAt: string
  closedAt: string | null
  /** จำนวนครั้งที่ถูกเลื่อนหรือยกข้ามวัน */
  rolloverCount: number
  /** วันที่วางแผนจะทำ: ลูปในกลุ่มวันนี้คือวันที่ถูกใส่เข้าวันนี้, ลูปที่เลื่อนไว้คือวันที่จะกลับเข้าวันนี้ */
  plannedDate: DateKey | null
  /** วันที่ถูกยกมาจากวันก่อนโดยอัตโนมัติ */
  carriedOn: DateKey | null
  /** วันแผนเดิมก่อนถูกยก (ไม่มีในข้อมูลก่อน spec 3) */
  carriedFrom?: DateKey | null
}

export interface LoopDraft {
  title: string
  project: string
  horizon: Horizon
  energy: Energy | null
  dueDate: DateKey | null
  estimateMinutes: number | null
  steps: Step[]
}

export interface WaitingInfo {
  waitingOn: string
  followUpDate: DateKey | null
}

export const STATUS_LABEL: Record<LoopStatus, string> = {
  active: 'กำลังทำ',
  waiting: 'รอคนอื่น',
  blocked: 'ติดขัด',
  done: 'เสร็จ',
  dropped: 'ทิ้ง',
}

export const HORIZON_LABEL: Record<Horizon, string> = {
  today: 'วันนี้',
  week: 'สัปดาห์นี้',
  later: 'ไว้ก่อน',
}

export const ENERGY_LABEL: Record<Energy, string> = {
  deep: 'ใช้สมาธิ',
  shallow: 'งานเบา',
}

export const TITLE_MAX = 200

export function newId(): string {
  return crypto.randomUUID()
}

export function newStep(title: string): Step {
  return { id: newId(), title: title.trim(), doneAt: null }
}

export function emptyDraft(horizon: Horizon = 'week'): LoopDraft {
  return { title: '', project: '', horizon, energy: null, dueDate: null, estimateMinutes: null, steps: [] }
}

export function draftFromLoop(loop: Loop): LoopDraft {
  return {
    title: loop.title,
    project: loop.project ?? '',
    horizon: loop.horizon,
    energy: loop.energy,
    dueDate: loop.dueDate,
    estimateMinutes: loop.estimateMinutes,
    steps: loop.steps.map((s) => ({ ...s })),
  }
}

export type DraftErrors = Partial<Record<'title' | 'estimate', string>>

export function validateDraft(draft: LoopDraft): DraftErrors {
  const errors: DraftErrors = {}
  const title = draft.title.trim()
  if (!title) errors.title = 'ใส่ชื่องานก่อน'
  else if (title.length > TITLE_MAX) errors.title = `ชื่องานยาวได้ไม่เกิน ${TITLE_MAX} ตัวอักษร`
  if (draft.estimateMinutes !== null && !(draft.estimateMinutes > 0)) {
    errors.estimate = 'เวลาที่ใช้ต้องมากกว่า 0'
  }
  return errors
}

export function isValidDraft(draft: LoopDraft): boolean {
  return Object.keys(validateDraft(draft)).length === 0
}

function cleanSteps(steps: Step[]): Step[] {
  return steps.map((s) => ({ ...s, title: s.title.trim() })).filter((s) => s.title)
}

function draftFields(draft: LoopDraft) {
  return {
    title: draft.title.trim(),
    project: draft.project.trim() || null,
    horizon: draft.horizon,
    energy: draft.energy,
    dueDate: draft.dueDate,
    estimateMinutes: draft.estimateMinutes,
    steps: cleanSteps(draft.steps),
  }
}

export function createLoop(draft: LoopDraft, now: Date, id: string = newId()): Loop {
  if (!isValidDraft(draft)) throw new Error('createLoop: draft is invalid')
  const ts = now.toISOString()
  return {
    id,
    ...draftFields(draft),
    status: 'active',
    waitingOn: null,
    followUpDate: null,
    createdAt: ts,
    updatedAt: ts,
    lastProgressAt: ts,
    closedAt: null,
    rolloverCount: 0,
    plannedDate: draft.horizon === 'today' ? toDateKey(now) : null,
    carriedOn: null,
  }
}

/** แก้รายละเอียดจากฟอร์ม โดยไม่แตะสถานะและประวัติการขยับของลูป */
export function applyDraft(loop: Loop, draft: LoopDraft, now: Date): Loop {
  if (!isValidDraft(draft)) throw new Error('applyDraft: draft is invalid')
  // เปลี่ยนช่วงเวลาเฉพาะเมื่อผู้ใช้เปลี่ยนจริง จะได้ไม่ล้างวันที่ลงไว้บนบอร์ด
  const base = draft.horizon === loop.horizon ? loop : setHorizon(loop, draft.horizon, now)
  return { ...base, ...draftFields(draft), updatedAt: now.toISOString() }
}

export function isClosed(loop: Loop): boolean {
  return loop.status === 'done' || loop.status === 'dropped'
}

export function progress(loop: Loop): { done: number; total: number } {
  return { done: loop.steps.filter((s) => s.doneAt).length, total: loop.steps.length }
}

/** ขั้นแรกที่ยังไม่เสร็จ ตามลำดับที่ผู้ใช้เรียงไว้ */
export function nextStep(loop: Loop): Step | null {
  return loop.steps.find((s) => !s.doneAt) ?? null
}

/**
 * ติ๊กหรือเลิกติ๊กขั้น ถ้าขั้นสุดท้ายถูกติ๊กครบ ลูปจะปิดเป็น done
 * ถ้าเลิกติ๊กขั้นของลูปที่ปิดไปแล้ว ลูปจะกลับมาเปิด
 */
export function toggleStep(loop: Loop, stepId: string, now: Date): Loop {
  const ts = now.toISOString()
  const target = loop.steps.find((s) => s.id === stepId)
  if (!target) return loop
  const checking = !target.doneAt
  const steps = loop.steps.map((s) => (s.id === stepId ? { ...s, doneAt: checking ? ts : null } : s))
  const next: Loop = { ...loop, steps, updatedAt: ts }
  if (checking) {
    next.lastProgressAt = ts
    if (steps.every((s) => s.doneAt)) return close(next, 'done', ts)
    return next
  }
  return loop.status === 'done' ? revive(next, 'active', now) : next
}

/** ปุ่มลัดบนการ์ด: ติ๊กขั้นถัดไป หรือปิดลูปถ้าไม่มีขั้นเหลือ */
export function advance(loop: Loop, now: Date): Loop {
  const step = nextStep(loop)
  if (step) return toggleStep(loop, step.id, now)
  return setStatus(loop, 'done', now)
}

export function validateWaiting(info: Partial<WaitingInfo>): Partial<Record<keyof WaitingInfo, string>> {
  const errors: Partial<Record<keyof WaitingInfo, string>> = {}
  if (!info.waitingOn?.trim()) errors.waitingOn = 'ระบุว่ารอใคร'
  if (!info.followUpDate) errors.followUpDate = 'เลือกวันที่จะตามงาน'
  return errors
}

export function setStatus(loop: Loop, status: LoopStatus, now: Date, waiting?: WaitingInfo): Loop {
  const ts = now.toISOString()
  if (status === 'waiting') {
    if (!waiting || Object.keys(validateWaiting(waiting)).length) {
      throw new Error('setStatus: waiting needs waitingOn and followUpDate')
    }
  }
  const base: Loop = {
    ...loop,
    status,
    updatedAt: ts,
    lastProgressAt: ts,
    waitingOn: status === 'waiting' ? waiting!.waitingOn.trim() : null,
    followUpDate: status === 'waiting' ? waiting!.followUpDate : null,
  }
  if (status === 'done' || status === 'dropped') return close(base, status, ts)
  return isClosed(loop) ? revive(base, status, now) : base
}

/** ย้ายไปช่วงเวลา: วันนี้ หรือกลับกองงาน (สัปดาห์นี้ / ไว้ก่อน) ซึ่งล้างวันที่ลงไว้ ไม่นับเป็นการเลื่อน */
export function setHorizon(loop: Loop, horizon: Horizon, now: Date): Loop {
  const ts = now.toISOString()
  if (horizon === 'today' && loop.horizon === 'today') return { ...loop, updatedAt: ts }
  return {
    ...loop,
    horizon,
    plannedDate: horizon === 'today' ? toDateKey(now) : null,
    carriedOn: null,
    updatedAt: ts,
  }
}

export function setEstimate(loop: Loop, estimateMinutes: number | null, now: Date): Loop {
  return { ...loop, estimateMinutes, updatedAt: now.toISOString() }
}

/**
 * ลงงานไว้ที่วัน `date` พอถึงวันนั้น startDay จะดึงเข้าวันนี้เอง
 * ย้ายลูปที่ยังเปิดอยู่ออกจากวันนี้ไปวันหลัง นับเป็นการเลื่อนหนึ่งครั้ง
 */
export function scheduleOn(loop: Loop, date: DateKey, now: Date): Loop {
  const today = toDateKey(now)
  if (date < today) throw new Error('scheduleOn: date is in the past')
  if (date === today) return setHorizon(loop, 'today', now)
  const leavingToday = loop.horizon === 'today' && !isClosed(loop)
  return {
    ...loop,
    horizon: 'week',
    plannedDate: date,
    carriedOn: null,
    rolloverCount: loop.rolloverCount + (leavingToday ? 1 : 0),
    updatedAt: now.toISOString(),
  }
}

/** ตัวเลือก "ทำเมื่อไหร่": วันที่ (YYYY-MM-DD) หรือกองงาน */
export type PlanValue = DateKey | 'week' | 'later'

export function planValueOf(loop: Loop, today: DateKey): PlanValue {
  if (loop.horizon === 'today') return today
  return loop.plannedDate ?? loop.horizon
}

export function applyPlan(loop: Loop, value: PlanValue, now: Date): Loop {
  return value === 'week' || value === 'later' ? setHorizon(loop, value, now) : scheduleOn(loop, value, now)
}

/**
 * งานเปิดวันใหม่: คืนเฉพาะลูปที่เปลี่ยน
 * - ลูปในวันนี้ที่ค้างจากวันก่อน ถูกยกมาและนับการเลื่อน +1
 *   ยกเว้นลูปที่รอคนอื่น ซึ่งยกมาเฉย ๆ ไม่นับ เพราะผู้ใช้ไม่ได้เป็นคนเลื่อน
 * - ลูปที่วางแผนไว้ถึงวันนี้แล้ว ถูกดึงเข้าวันนี้ (นับไปแล้วตอนกดเลื่อน)
 * รันซ้ำในวันเดียวกันต้องไม่เปลี่ยนอะไรเพิ่ม
 */
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

export function startDay(loops: Loop[], today: DateKey, workdays: number[] = ALL_DAYS): Loop[] {
  // วันหยุดไม่ยกงาน งานค้างรอยกในวันทำงานถัดไปครั้งเดียว
  const workday = workdays.includes(weekdayOf(today))
  const changed: Loop[] = []
  for (const loop of loops) {
    if (isClosed(loop)) continue
    if (loop.horizon === 'today') {
      if (!loop.plannedDate) changed.push({ ...loop, plannedDate: today })
      else if (loop.plannedDate < today && workday) {
        changed.push(
          loop.status === 'waiting'
            ? { ...loop, plannedDate: today }
            : {
                ...loop,
                plannedDate: today,
                carriedOn: today,
                carriedFrom: loop.plannedDate,
                rolloverCount: loop.rolloverCount + 1,
              },
        )
      }
    } else if (loop.plannedDate && loop.plannedDate <= today) {
      changed.push({ ...loop, horizon: 'today', plannedDate: today, carriedOn: null })
    }
  }
  return changed
}

export function addStep(loop: Loop, title: string, now: Date): Loop {
  if (!title.trim()) return loop
  const next = { ...loop, steps: [...loop.steps, newStep(title)], updatedAt: now.toISOString() }
  // เพิ่มขั้นใหม่ให้ลูปที่เสร็จแล้ว แปลว่างานยังไม่จบจริง
  return loop.status === 'done' ? revive(next, 'active', now) : next
}

function close(loop: Loop, status: 'done' | 'dropped', ts: string): Loop {
  return { ...loop, status, closedAt: ts, waitingOn: null, followUpDate: null }
}

/** เปิดลูปที่ปิดไปแล้วกลับมา ถ้าอยู่ในกลุ่มวันนี้ให้นับเป็นงานของวันนี้ ไม่ใช่งานยกมา */
function revive(loop: Loop, status: LoopStatus, now: Date): Loop {
  return {
    ...loop,
    status,
    closedAt: null,
    plannedDate: loop.horizon === 'today' ? toDateKey(now) : loop.plannedDate,
    carriedOn: null,
  }
}

export type Section = Horizon | 'closed'

export const SECTIONS: Section[] = ['today', 'week', 'later', 'closed']

const statusRank: Record<LoopStatus, number> = { active: 0, blocked: 1, waiting: 2, done: 3, dropped: 3 }

export function compareOpen(a: Loop, b: Loop): number {
  return (
    statusRank[a.status] - statusRank[b.status] ||
    (a.plannedDate ?? '9999-12-31').localeCompare(b.plannedDate ?? '9999-12-31') ||
    (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') ||
    a.createdAt.localeCompare(b.createdAt)
  )
}

/** กลุ่มในหน้ารายการ: ลูปที่ลงวันไว้ไปอยู่ตามวันที่ (ถึงวันอาทิตย์นี้ = สัปดาห์นี้, หลังจากนั้น = ไว้ก่อน) */
export function sectionOf(loop: Loop, today: DateKey | null): Section {
  if (isClosed(loop)) return 'closed'
  if (loop.horizon === 'today' || !loop.plannedDate || !today) return loop.horizon
  return loop.plannedDate <= addDays(startOfWeek(today), 6) ? 'week' : 'later'
}

/** จัดกลุ่มตามช่วงเวลา ลูปที่ยังทำได้อยู่บน, ลูปที่รอคนอื่นอยู่ล่าง, ปิดแล้วเรียงล่าสุดก่อน */
export function groupLoops(loops: Loop[], today: DateKey | null = null): Record<Section, Loop[]> {
  const groups: Record<Section, Loop[]> = { today: [], week: [], later: [], closed: [] }
  for (const loop of loops) groups[sectionOf(loop, today)].push(loop)
  groups.today.sort(compareOpen)
  groups.week.sort(compareOpen)
  groups.later.sort(compareOpen)
  groups.closed.sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))
  return groups
}

export function projectsOf(loops: Loop[]): string[] {
  return [...new Set(loops.map((l) => l.project).filter((p): p is string => !!p))].sort((a, b) =>
    a.localeCompare(b, 'th'),
  )
}
