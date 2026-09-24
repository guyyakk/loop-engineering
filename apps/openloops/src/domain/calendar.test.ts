import { describe, expect, it } from 'vitest'
import {
  AUTO_SYNC_MS,
  CalendarError,
  busyMinutesByDay,
  errorFromStatus,
  freeBusyBody,
  isStale,
  parseFreeBusy,
  shouldAutoSync,
  syncRange,
  tokenValid,
  validateClientId,
} from './calendar'
import { DEFAULT_SETTINGS, loadForDay } from './capacity'
import { createLoop, emptyDraft } from './loop'

// เวลาในเทสต์ใช้เวลาเครื่อง: new Date(ปี, เดือน-1, วัน, ชม., นาที)
const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m).toISOString()
const WORK = { start: 9 * 60, minutes: 8 * 60 } // 09:00–17:00

describe('client id', () => {
  it('accepts Google web client ids only', () => {
    expect(validateClientId('')).toBeTruthy()
    expect(validateClientId('my-secret')).toBeTruthy()
    expect(validateClientId('123456789012-abc123def456.apps.googleusercontent.com')).toBeNull()
    expect(validateClientId('  123-abc.apps.googleusercontent.com  ')).toBeNull()
  })
})

describe('sync range', () => {
  it('covers Monday of this week through Sunday of next week', () => {
    const range = syncRange('2026-09-24')
    expect(range.days).toHaveLength(14)
    expect(range.days[0]).toBe('2026-09-21')
    expect(range.days[13]).toBe('2026-10-04')
    expect(range.timeMin).toBe(new Date(2026, 8, 21).toISOString())
    expect(range.timeMax).toBe(new Date(2026, 9, 5).toISOString())
    expect(freeBusyBody('2026-09-24').items).toEqual([{ id: 'primary' }])
  })
})

describe('busy minutes', () => {
  const days = ['2026-09-24', '2026-09-25', '2026-09-26']

  it('merges overlapping events and counts only working hours', () => {
    const busy = [
      { start: at(24, 10), end: at(24, 11) },
      { start: at(24, 10, 30), end: at(24, 12) }, // ซ้อน → 10:00–12:00 = 120
      { start: at(24, 8), end: at(24, 9, 30) }, // ก่อนเริ่มงาน นับแค่ 30
      { start: at(24, 16, 30), end: at(24, 18) }, // หลังเลิกงาน นับแค่ 30
      { start: at(24, 19), end: at(24, 20) }, // นอกเวลางานทั้งหมด
    ]
    expect(busyMinutesByDay(busy, days, WORK.start, WORK.minutes)).toEqual({
      '2026-09-24': 180,
      '2026-09-25': 0,
      '2026-09-26': 0,
    })
  })

  it('splits a multi-day block across each working day', () => {
    const busy = [{ start: at(24, 15), end: at(26, 10) }]
    expect(busyMinutesByDay(busy, days, WORK.start, WORK.minutes)).toEqual({
      '2026-09-24': 120,
      '2026-09-25': 480,
      '2026-09-26': 60,
    })
  })

  it('ignores broken intervals and follows the configured work hours', () => {
    const busy = [
      { start: 'x', end: at(24, 12) },
      { start: at(24, 12), end: at(24, 11) },
      { start: at(24, 7), end: at(24, 8) },
    ]
    expect(busyMinutesByDay(busy, ['2026-09-24'], 7 * 60, 60)).toEqual({ '2026-09-24': 60 })
  })
})

describe('free/busy response', () => {
  it('reads busy intervals of the primary calendar', () => {
    const json = { calendars: { primary: { busy: [{ start: 'a', end: 'b' }, { start: 1 }] } } }
    expect(parseFreeBusy(json)).toEqual([{ start: 'a', end: 'b' }])
    expect(parseFreeBusy({ calendars: { 'me@example.com': { busy: [] } } })).toEqual([])
  })

  it('raises a calendar error when Google reports one', () => {
    expect(() => parseFreeBusy({ calendars: { primary: { errors: [{ reason: 'notFound' }] } } })).toThrow(CalendarError)
    expect(() => parseFreeBusy({})).toThrow(CalendarError)
    expect(errorFromStatus(401)).toBe('expired')
    expect(errorFromStatus(403)).toBe('forbidden')
    expect(errorFromStatus(500)).toBe('unknown')
  })
})

describe('auto sync', () => {
  const now = Date.parse(at(25, 10))
  const token = { accessToken: 't', expiresAt: now + 30 * 60_000 }

  it('only syncs silently with a valid token and after the cool-down', () => {
    expect(shouldAutoSync(now, null, null)).toBe(false)
    expect(shouldAutoSync(now, { ...token, expiresAt: now + 30_000 }, null)).toBe(false)
    expect(shouldAutoSync(now, token, null)).toBe(true)
    expect(shouldAutoSync(now, token, new Date(now - 5 * 60_000).toISOString())).toBe(false)
    expect(shouldAutoSync(now, token, new Date(now - AUTO_SYNC_MS).toISOString())).toBe(true)
    expect(tokenValid(token, now)).toBe(true)
  })

  it('flags data older than a day', () => {
    expect(isStale(null, now)).toBe(false)
    expect(isStale(new Date(now - 23 * 3600_000).toISOString(), now)).toBe(false)
    expect(isStale(new Date(now - 25 * 3600_000).toISOString(), now)).toBe(true)
  })
})

describe('free time with calendar data', () => {
  const loops = [createLoop({ ...emptyDraft('today'), title: 'a', estimateMinutes: 120 }, new Date(2026, 8, 24, 9), 'a')]

  it('adds calendar minutes and manual extras without double counting', () => {
    const manualOnly = loadForDay(loops, '2026-09-24', '2026-09-24', DEFAULT_SETTINGS, 60)
    expect(manualOnly).toMatchObject({ meetingMinutes: 60, calendarMinutes: null, freeMinutes: 360 })

    const withCalendar = loadForDay(loops, '2026-09-24', '2026-09-24', DEFAULT_SETTINGS, { manual: 30, calendar: 150 })
    expect(withCalendar).toMatchObject({ meetingMinutes: 30, calendarMinutes: 150, freeMinutes: 240 })

    const calendarOnly = loadForDay(loops, '2026-09-24', '2026-09-24', DEFAULT_SETTINGS, { manual: 0, calendar: 0 })
    expect(calendarOnly).toMatchObject({ calendarMinutes: 0, freeMinutes: 420 })
  })
})
