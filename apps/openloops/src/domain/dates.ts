// วันที่ในแอปเก็บเป็น date key แบบ 'YYYY-MM-DD' ตามเวลาท้องถิ่น
// เพื่อไม่ให้ลูปเลื่อนวันเพราะ timezone เวลาแปลงเป็น ISO

export type DateKey = string

const pad = (n: number) => String(n).padStart(2, '0')

export function toDateKey(d: Date): DateKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** วันตามเวลาท้องถิ่นของ timestamp แบบ ISO */
export function dateKeyOf(iso: string): DateKey {
  return toDateKey(new Date(iso))
}

export function fromDateKey(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(key: DateKey, days: number): DateKey {
  const d = fromDateKey(key)
  d.setDate(d.getDate() + days)
  return toDateKey(d)
}

/** วัน `weekday` (0 = อาทิตย์) ที่ใกล้ที่สุดตั้งแต่ `from` เป็นต้นไป นับวันนี้ด้วย */
export function nextWeekday(from: DateKey, weekday: number): DateKey {
  const diff = (weekday - fromDateKey(from).getDay() + 7) % 7
  return addDays(from, diff)
}

export function weekdayOf(key: DateKey): number {
  return fromDateKey(key).getDay()
}

/** วันจันทร์ของสัปดาห์ที่มี `key` อยู่ */
export function startOfWeek(key: DateKey): DateKey {
  return addDays(key, -((weekdayOf(key) + 6) % 7))
}

export function weekDays(weekStart: DateKey): DateKey[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
}

/** วันทำงานวันแรกหลัง `from` (ไม่นับ `from`) ถ้าไม่ได้ตั้งวันทำงานไว้เลย ใช้วันถัดไป */
export function nextWorkday(from: DateKey, workdays: number[]): DateKey {
  if (workdays.length === 0) return addDays(from, 1)
  let day = addDays(from, 1)
  while (!workdays.includes(weekdayOf(day))) day = addDays(day, 1)
  return day
}

export const WEEKDAY_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']

/** "ศ. 26" แบบสั้นสำหรับหัวคอลัมน์และปุ่มเลือกวัน */
export function formatShortDay(key: DateKey): string {
  return `${WEEKDAY_SHORT[weekdayOf(key)]} ${fromDateKey(key).getDate()}`
}

const rangeFmt = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' })

export function formatWeekRange(weekStart: DateKey): string {
  return `${rangeFmt.format(fromDateKey(weekStart))} – ${rangeFmt.format(fromDateKey(addDays(weekStart, 6)))}`
}

export function daysBetween(from: DateKey, to: DateKey): number {
  return Math.round((fromDateKey(to).getTime() - fromDateKey(from).getTime()) / 86_400_000)
}

const shortFmt = new Intl.DateTimeFormat('th-TH', { weekday: 'short', day: 'numeric', month: 'short' })
const longFmt = new Intl.DateTimeFormat('th-TH', { weekday: 'long', day: 'numeric', month: 'long' })

export function formatDay(key: DateKey, today: DateKey): string {
  const diff = daysBetween(today, key)
  if (diff === 0) return 'วันนี้'
  if (diff === 1) return 'พรุ่งนี้'
  if (diff === -1) return 'เมื่อวาน'
  return shortFmt.format(fromDateKey(key))
}

/** ต่อคำนำหน้ากับวัน: "ส่งพรุ่งนี้" แต่ "ส่ง ศ. 26 ก.ย." เพื่อให้อ่านง่าย */
export function withDay(prefix: string, key: DateKey, today: DateKey): string {
  const day = formatDay(key, today)
  return Math.abs(daysBetween(today, key)) <= 1 ? prefix + day : `${prefix} ${day}`
}

export function formatLongDay(key: DateKey): string {
  return longFmt.format(fromDateKey(key))
}

export type DueTone = 'overdue' | 'today' | 'soon' | 'later'

export function dueTone(due: DateKey, today: DateKey): DueTone {
  const diff = daysBetween(today, due)
  if (diff < 0) return 'overdue'
  if (diff === 0) return 'today'
  if (diff <= 2) return 'soon'
  return 'later'
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} นาที`
  const hours = Math.round((minutes / 60) * 10) / 10
  return `${hours} ชม.`
}
