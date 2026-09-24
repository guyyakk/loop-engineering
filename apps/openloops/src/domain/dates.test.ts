import { describe, expect, it } from 'vitest'
import { addDays, dueTone, formatDay, formatMinutes, nextWeekday, toDateKey, withDay } from './dates'

describe('dates', () => {
  it('uses local calendar days', () => {
    expect(toDateKey(new Date(2026, 8, 24, 23, 59))).toBe('2026-09-24')
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('finds the next weekday including today', () => {
    // 2026-09-24 เป็นวันพฤหัสบดี
    expect(nextWeekday('2026-09-24', 5)).toBe('2026-09-25')
    expect(nextWeekday('2026-09-25', 5)).toBe('2026-09-25')
    expect(nextWeekday('2026-09-26', 5)).toBe('2026-10-02')
    expect(nextWeekday('2026-09-25', 1)).toBe('2026-09-28')
  })

  it('formats relative days in Thai', () => {
    expect(formatDay('2026-09-24', '2026-09-24')).toBe('วันนี้')
    expect(formatDay('2026-09-25', '2026-09-24')).toBe('พรุ่งนี้')
    expect(formatDay('2026-09-23', '2026-09-24')).toBe('เมื่อวาน')
    expect(withDay('ส่ง', '2026-09-25', '2026-09-24')).toBe('ส่งพรุ่งนี้')
    expect(withDay('ส่ง', '2026-09-30', '2026-09-24')).toMatch(/^ส่ง \S/)
  })

  it('classifies due dates', () => {
    expect(dueTone('2026-09-23', '2026-09-24')).toBe('overdue')
    expect(dueTone('2026-09-24', '2026-09-24')).toBe('today')
    expect(dueTone('2026-09-26', '2026-09-24')).toBe('soon')
    expect(dueTone('2026-10-01', '2026-09-24')).toBe('later')
  })

  it('formats durations', () => {
    expect(formatMinutes(30)).toBe('30 นาที')
    expect(formatMinutes(60)).toBe('1 ชม.')
    expect(formatMinutes(90)).toBe('1.5 ชม.')
  })
})
