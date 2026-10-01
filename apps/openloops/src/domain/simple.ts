import { addDays, dateKeyOf, daysBetween, fromDateKey, nextWeekday, startOfWeek, toDateKey, withDay, type DateKey } from './dates'
import { TITLE_MAX, emptyDraft, isClosed, setHorizon, type Loop, type LoopDraft } from './loop'

// โหมดง่าย: รายการงานแบบติ๊กเสร็จ แบ่งเป็น วันนี้ / สัปดาห์นี้ / เดือนนี้
// งานที่เสร็จไม่หาย จางอยู่ในแท็บจนจบช่วงนั้น แล้วไปอยู่ในย้อนดู

export type Tab = 'today' | 'week' | 'month'

export const TABS: Tab[] = ['today', 'week', 'month']

export const TAB_LABEL: Record<Tab, string> = { today: 'วันนี้', week: 'สัปดาห์นี้', month: 'เดือนนี้' }

/** ป้ายบอกว่างานที่เสร็จมาจากรายการไหน ใช้ในย้อนดู (คำว่า "วันนี้" ในวันก่อน ๆ จะอ่านสับสน) */
export const PLAN_LABEL: Record<Tab, string> = { today: 'แผนวัน', week: 'แผนสัปดาห์', month: 'แผนเดือน' }

export function startOfMonth(today: DateKey): DateKey {
  return `${today.slice(0, 8)}01`
}

export function endOfMonth(today: DateKey): DateKey {
  const d = fromDateKey(today)
  return toDateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}

/** แท็บของงาน: งาน "ไว้ก่อน" จากโหมดละเอียดอยู่ในเดือนนี้ */
export function tabOf(loop: Loop): Tab {
  if (loop.horizon === 'today') return 'today'
  return loop.horizon === 'week' ? 'week' : 'month'
}

/** วันแรกของช่วงที่งานเสร็จยังแสดงในแท็บ */
export function periodStart(tab: Tab, today: DateKey): DateKey {
  if (tab === 'today') return today
  return tab === 'week' ? startOfWeek(today) : startOfMonth(today)
}

const isDone = (loop: Loop) => loop.status === 'done' && loop.closedAt !== null

/** ถึงหรือเลยวันที่ตั้งว่าจะเสร็จแล้ว */
export function isDueBy(loop: Loop, today: DateKey): boolean {
  return loop.dueDate !== null && loop.dueDate <= today
}

/** แท็บวันนี้รวมงานจากแท็บอื่นที่ครบกำหนดแล้วด้วย */
function belongs(loop: Loop, tab: Tab, today: DateKey): boolean {
  return tabOf(loop) === tab || (tab === 'today' && isDueBy(loop, today))
}

/** เลยกำหนดก่อน → เสร็จภายในใกล้สุด → ไม่กำหนด, แล้วตามลำดับที่เพิ่ม */
function compareOpenSimple(a: Loop, b: Loop): number {
  return (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') || a.createdAt.localeCompare(b.createdAt)
}

export interface TabItems {
  open: Loop[]
  /** เสร็จในช่วงนี้ ล่าสุดก่อน */
  done: Loop[]
}

export function tabItems(loops: Loop[], tab: Tab, today: DateKey): TabItems {
  const start = periodStart(tab, today)
  return {
    open: loops.filter((l) => !isClosed(l) && belongs(l, tab, today)).sort(compareOpenSimple),
    done: loops
      .filter((l) => isDone(l) && belongs(l, tab, today) && dateKeyOf(l.closedAt!) >= start)
      .sort((a, b) => b.closedAt!.localeCompare(a.closedAt!)),
  }
}

export type BadgeTone = 'danger' | 'warn' | 'info' | 'muted'

export interface Badge {
  text: string
  tone: BadgeTone
}

/** ป้ายสั้น ๆ ของงานค้าง: กำหนดเสร็จ, มาจากแท็บไหน, ค้างมาจากเมื่อไหร่ */
export function itemBadges(loop: Loop, tab: Tab, today: DateKey): Badge[] {
  if (isClosed(loop)) return []
  const out: Badge[] = []
  if (loop.dueDate) {
    const diff = daysBetween(today, loop.dueDate)
    if (diff < 0) out.push({ text: `เลยกำหนด ${-diff} วัน`, tone: 'danger' })
    else if (diff === 0) out.push({ text: 'ครบกำหนดวันนี้', tone: 'warn' })
    else out.push({ text: withDay('ภายใน', loop.dueDate, today), tone: 'muted' })
  }
  const home = tabOf(loop)
  if (tab === 'today' && home !== 'today') out.push({ text: `จาก${TAB_LABEL[home]}`, tone: 'info' })
  if (tab === 'today' && loop.carriedOn === today) {
    out.push({ text: loop.carriedFrom ? withDay('ค้างจาก', loop.carriedFrom, today) : 'ค้างจากวันก่อน', tone: 'warn' })
  }
  if (loop.horizon !== 'today' && loop.plannedDate && loop.plannedDate > today) {
    out.push({ text: withDay('ลงไว้', loop.plannedDate, today), tone: 'muted' })
  }
  if (tab === 'week' && dateKeyOf(loop.createdAt) < startOfWeek(today)) out.push({ text: 'จากสัปดาห์ก่อน', tone: 'muted' })
  if (tab === 'month' && dateKeyOf(loop.createdAt) < startOfMonth(today)) out.push({ text: 'จากเดือนก่อน', tone: 'muted' })
  if (tab === 'month' && loop.horizon === 'later') out.push({ text: 'ไว้ก่อน', tone: 'muted' })
  if (loop.status === 'waiting' && loop.waitingOn) out.push({ text: `รอ ${loop.waitingOn}`, tone: 'info' })
  return out
}

export interface HistoryDay {
  date: DateKey
  items: Loop[]
}

/** งานที่เสร็จ จัดกลุ่มตามวันที่ติ๊ก ล่าสุดก่อน */
export function historyDays(loops: Loop[], maxDays = Infinity): HistoryDay[] {
  const days: HistoryDay[] = []
  for (const loop of loops.filter(isDone).sort((a, b) => b.closedAt!.localeCompare(a.closedAt!))) {
    const date = dateKeyOf(loop.closedAt!)
    const last = days[days.length - 1]
    if (last?.date === date) last.items.push(loop)
    else if (days.length < maxDays) days.push({ date, items: [loop] })
    else break
  }
  return days
}

export function doneSince(loops: Loop[], from: DateKey): number {
  return loops.filter((l) => isDone(l) && dateKeyOf(l.closedAt!) >= from).length
}

export interface DueOption {
  value: DateKey | null
  label: string
}

/** ตัวเลือก "เสร็จภายใน" ตัดวันที่ซ้ำกันออก เช่น วันศุกร์ "ศุกร์นี้" คือ "วันนี้" */
export function dueOptions(today: DateKey): DueOption[] {
  const options: DueOption[] = [
    { value: null, label: 'ไม่กำหนด' },
    { value: today, label: 'วันนี้' },
    { value: addDays(today, 1), label: 'พรุ่งนี้' },
    { value: nextWeekday(today, 5), label: 'ศุกร์นี้' },
    { value: endOfMonth(today), label: 'สิ้นเดือน' },
  ]
  return options.filter((o, i) => options.findIndex((x) => x.value === o.value) === i)
}

export interface SimpleValues {
  title: string
  tab: Tab
  dueDate: DateKey | null
}

export function validateTitle(title: string): string | null {
  const t = title.trim()
  if (!t) return 'ใส่ชื่องานก่อน'
  if (t.length > TITLE_MAX) return `ชื่องานยาวได้ไม่เกิน ${TITLE_MAX} ตัวอักษร`
  return null
}

export function simpleDraft(values: SimpleValues): LoopDraft {
  return { ...emptyDraft(values.tab), title: values.title.trim(), dueDate: values.dueDate }
}

export function valuesOf(loop: Loop): SimpleValues {
  return { title: loop.title, tab: tabOf(loop), dueDate: loop.dueDate }
}

/** แก้จากโหมดง่าย: ย้ายแท็บเฉพาะเมื่อเปลี่ยนจริง จะได้ไม่ล้างวันที่ลงไว้หรือเปลี่ยนงาน "ไว้ก่อน" โดยไม่ตั้งใจ */
export function applySimpleEdit(loop: Loop, values: SimpleValues, now: Date): Loop {
  const moved = values.tab === tabOf(loop) ? loop : setHorizon(loop, values.tab, now)
  return { ...moved, title: values.title.trim(), dueDate: values.dueDate, updatedAt: now.toISOString() }
}
