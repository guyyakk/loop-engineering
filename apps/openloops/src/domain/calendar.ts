import { addDays, fromDateKey, startOfWeek, weekDays, type DateKey } from './dates'

// Google Calendar แบบอ่านอย่างเดียว: แอปเห็นแค่ "ช่วงไม่ว่าง" ไม่เห็นชื่อหรือรายละเอียดนัด

/** scope แคบที่สุดที่ใช้ freeBusy ได้ */
export const FREEBUSY_SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy'
export const FREEBUSY_URL = 'https://www.googleapis.com/calendar/v3/freeBusy'
/** ซิงก์อัตโนมัติได้เมื่อซิงก์ครั้งล่าสุดเกินเท่านี้ */
export const AUTO_SYNC_MS = 15 * 60_000
/** ข้อมูลปฏิทินเก่าเกินเท่านี้ถึงเตือน */
export const STALE_MS = 24 * 60 * 60_000
/** เผื่อเวลาก่อน token หมดอายุ จะได้ไม่ส่งคำขอด้วย token ที่กำลังจะหมด */
const TOKEN_MARGIN_MS = 60_000

const CLIENT_ID = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/

export function validateClientId(value: string): string | null {
  const v = value.trim()
  if (!v) return 'ใส่ Client ID ก่อน'
  if (!CLIENT_ID.test(v)) return 'รูปแบบไม่ถูกต้อง Client ID ต้องลงท้ายด้วย .apps.googleusercontent.com'
  return null
}

export interface BusyInterval {
  start: string
  end: string
}

/** ช่วงวันที่ซิงก์: จันทร์ของสัปดาห์นี้ถึงอาทิตย์ของสัปดาห์หน้า */
export function syncRange(today: DateKey): { days: DateKey[]; timeMin: string; timeMax: string } {
  const start = startOfWeek(today)
  const days = [...weekDays(start), ...weekDays(addDays(start, 7))]
  return {
    days,
    timeMin: fromDateKey(days[0]).toISOString(),
    timeMax: fromDateKey(addDays(days[days.length - 1], 1)).toISOString(),
  }
}

export function freeBusyBody(today: DateKey) {
  const { timeMin, timeMax } = syncRange(today)
  return { timeMin, timeMax, items: [{ id: 'primary' }] }
}

/** รวมช่วงที่ซ้อนหรือชนกัน */
function mergeIntervals(busy: BusyInterval[]): [number, number][] {
  const spans = busy
    .map((b) => [Date.parse(b.start), Date.parse(b.end)] as [number, number])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
    .sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const span of spans) {
    const last = merged[merged.length - 1]
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1])
    else merged.push([...span])
  }
  return merged
}

/**
 * นาทีไม่ว่างในเวลางานของแต่ละวัน (ตามเวลาเครื่อง)
 * ช่วงซ้อนกันนับครั้งเดียว ส่วนที่อยู่นอกเวลางานไม่นับ ช่วงข้ามวันแบ่งตามแต่ละวัน
 */
export function busyMinutesByDay(
  busy: BusyInterval[],
  days: DateKey[],
  startMinutes: number,
  workMinutes: number,
): Record<DateKey, number> {
  const merged = mergeIntervals(busy)
  const result: Record<DateKey, number> = {}
  for (const day of days) {
    const base = fromDateKey(day)
    const from = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, startMinutes).getTime()
    const to = from + workMinutes * 60_000
    let ms = 0
    for (const [s, e] of merged) ms += Math.max(0, Math.min(e, to) - Math.max(s, from))
    result[day] = Math.round(ms / 60_000)
  }
  return result
}

export type CalendarErrorKind =
  | 'popup-closed'
  | 'access-denied'
  | 'bad-client'
  | 'expired'
  | 'forbidden'
  | 'network'
  | 'calendar'
  | 'not-loaded'
  | 'unknown'

export class CalendarError extends Error {
  constructor(public kind: CalendarErrorKind) {
    super(kind)
  }
}

export function calendarErrorText(kind: CalendarErrorKind): string {
  switch (kind) {
    case 'popup-closed':
      return 'หน้าต่างขอสิทธิ์ถูกปิดก่อนเสร็จ กดเชื่อมต่ออีกครั้งได้เลย'
    case 'access-denied':
      return 'ยังไม่ได้อนุญาตให้ดูช่วงเวลาว่างของปฏิทิน ต้องติ๊กอนุญาตในหน้าต่างของ Google'
    case 'bad-client':
      return 'Google ไม่รู้จัก Client ID นี้ หรือยังไม่ได้เพิ่มที่อยู่ของแอปใน Authorized JavaScript origins'
    case 'expired':
      return 'สิทธิ์ที่ได้มาหมดอายุแล้ว กดซิงก์อีกครั้ง'
    case 'forbidden':
      return 'Google ปฏิเสธคำขอ ตรวจว่าเปิดใช้ Google Calendar API ในโปรเจกต์แล้ว'
    case 'network':
      return 'เชื่อมต่อ Google ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่'
    case 'calendar':
      return 'Google อ่านปฏิทินหลักไม่ได้ ลองใหม่อีกครั้งภายหลัง'
    case 'not-loaded':
      return 'กำลังเตรียมการเชื่อมต่อกับ Google กดอีกครั้งในอีกสักครู่'
    case 'unknown':
      return 'เชื่อมต่อ Google Calendar ไม่สำเร็จ ลองใหม่อีกครั้ง'
  }
}

/** อ่านผลของ freeBusy ปฏิทินหลัก ถ้า Google แจ้งข้อผิดพลาดของปฏิทินให้โยน error */
export function parseFreeBusy(json: unknown): BusyInterval[] {
  const calendars = (json as { calendars?: Record<string, { busy?: unknown; errors?: unknown[] }> })?.calendars
  const primary = calendars?.primary ?? (calendars ? Object.values(calendars)[0] : undefined)
  if (!primary || (Array.isArray(primary.errors) && primary.errors.length)) throw new CalendarError('calendar')
  if (!Array.isArray(primary.busy)) return []
  return primary.busy.filter(
    (b): b is BusyInterval => typeof b === 'object' && b !== null && typeof b.start === 'string' && typeof b.end === 'string',
  )
}

export function errorFromStatus(status: number): CalendarErrorKind {
  if (status === 401) return 'expired'
  if (status === 403) return 'forbidden'
  return 'unknown'
}

export interface CalendarToken {
  accessToken: string
  expiresAt: number
}

export function tokenValid(token: CalendarToken | null, now: number): boolean {
  return token !== null && token.expiresAt - TOKEN_MARGIN_MS > now
}

/** ซิงก์เองโดยไม่เปิด popup ได้ก็ต่อเมื่อยังมี token ที่ใช้ได้ และซิงก์ครั้งล่าสุดนานพอแล้ว */
export function shouldAutoSync(now: number, token: CalendarToken | null, lastSyncAt: string | null): boolean {
  if (!tokenValid(token, now)) return false
  return !lastSyncAt || now - Date.parse(lastSyncAt) >= AUTO_SYNC_MS
}

export function isStale(lastSyncAt: string | null, now: number): boolean {
  return lastSyncAt !== null && now - Date.parse(lastSyncAt) > STALE_MS
}
