import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, computeDayLoad, type PlannerSettings } from './capacity'
import { createLoop, emptyDraft, newStep, setStatus, toggleStep, type Loop, type LoopDraft } from './loop'
import {
  addWorkdays,
  briefMessage,
  followUpMessage,
  latestStart,
  loopFlags,
  markFollowedUp,
  nudgesFor,
  pendingNotifications,
  shutdownMessage,
  workdaysBetween,
} from './nudges'

// 2026-09-24 = พฤหัสบดี; ค่าเริ่มต้น ว่างวันละ 7 ชม. → งานหนึ่งชิ้นใช้ได้ 3.5 ชม./วัน
const TODAY = '2026-09-24'
const thu = new Date(2026, 8, 24, 9, 0)
const S: PlannerSettings = DEFAULT_SETTINGS

function mk(title: string, patch: Partial<LoopDraft> = {}, at = thu): Loop {
  return createLoop({ ...emptyDraft('week'), title, ...patch }, at, title)
}

const kinds = (loops: Loop[]) => nudgesFor(loops, TODAY, S).map((n) => `${n.kind}:${n.loop.title}`)

describe('workday helpers', () => {
  it('counts workdays after `from` up to `to`', () => {
    expect(workdaysBetween('2026-09-24', '2026-09-24', S.workdays)).toBe(0)
    expect(workdaysBetween('2026-09-24', '2026-09-28', S.workdays)).toBe(2) // ศ., จ.
    expect(addWorkdays('2026-09-24', 3, S.workdays)).toBe('2026-09-29') // ศ., จ., อ.
  })
})

describe('latestStart', () => {
  it('walks back from the due date using half a day of free time per workday', () => {
    expect(latestStart(mk('none'), S)).toBeNull()
    expect(latestStart(mk('short', { dueDate: '2026-09-25', estimateMinutes: 120 }), S)).toBe('2026-09-25')
    expect(latestStart(mk('7h', { dueDate: '2026-09-25', estimateMinutes: 420 }), S)).toBe('2026-09-24')
    // ส่งวันจันทร์ 8 ชม.: จ. 3.5 + ศ. 3.5 + พฤ. 1 → เริ่มพฤหัส (ข้ามเสาร์อาทิตย์)
    expect(latestStart(mk('mon', { dueDate: '2026-09-28', estimateMinutes: 480 }), S)).toBe('2026-09-24')
  })

  it('uses the time still left, not the full estimate', () => {
    let loop = mk('half', { dueDate: '2026-09-25', estimateMinutes: 420, steps: ['a', 'b'].map(newStep) })
    loop = toggleStep(loop, loop.steps[0].id, thu)
    expect(latestStart(loop, S)).toBe('2026-09-25')
  })
})

describe('nudgesFor', () => {
  it('flags overdue, must-start, follow-up and stalled loops, one per loop, in priority order', () => {
    const lastWeek = new Date(2026, 8, 18, 10, 0) // ศุกร์ก่อน → 4 วันทำการถึงวันนี้
    const loops = [
      mk('stalled', { horizon: 'week' }, lastWeek),
      setStatus(mk('waiting'), 'waiting', thu, { waitingOn: 'พี่นก', followUpDate: TODAY }),
      mk('must', { dueDate: '2026-09-25', estimateMinutes: 420 }),
      mk('overdue', { dueDate: '2026-09-22' }, lastWeek),
      mk('fine', { dueDate: '2026-10-09', estimateMinutes: 60 }),
    ]
    expect(kinds(loops)).toEqual(['overdue:overdue', 'must-start:must', 'follow-up:waiting', 'stalled:stalled'])
  })

  it('does not ask to pull a loop that is already planned for today', () => {
    const inToday = mk('today', { horizon: 'today', dueDate: '2026-09-25', estimateMinutes: 420 })
    expect(kinds([inToday])).toEqual([])
    expect(loopFlags(inToday, TODAY, S).mustStartSince).toBe(TODAY)
  })

  it('ignores parked, waiting and closed loops for stalling', () => {
    const old = new Date(2026, 8, 1, 10, 0)
    const parked = mk('parked', { horizon: 'later' }, old)
    const waiting = setStatus(mk('waiting', {}, old), 'waiting', old, { waitingOn: 'x', followUpDate: '2026-10-30' })
    const closed = setStatus(mk('closed', {}, old), 'done', old)
    expect(kinds([parked, waiting, closed])).toEqual([])
  })

  it('describes the nudge in Thai', () => {
    const late = setStatus(mk('late'), 'waiting', thu, { waitingOn: 'พี่นก', followUpDate: '2026-09-22' })
    expect(nudgesFor([late], TODAY, S)[0].text).toBe('เลยวันตามงานกับ พี่นก มา 2 วัน')
    const must = mk('must', { dueDate: '2026-09-25', estimateMinutes: 420 })
    expect(nudgesFor([must], TODAY, S)[0].text).toBe('ส่งพรุ่งนี้ เหลือ 7 ชม. · ต้องเริ่มวันนี้')
  })
})

describe('follow-up', () => {
  const waiting = setStatus(mk('ใบเสนอราคา ABC', { dueDate: '2026-09-25' }), 'waiting', thu, {
    waitingOn: 'พี่นก',
    followUpDate: TODAY,
  })

  it('drafts a message with the chosen particle and never sends it', () => {
    expect(followUpMessage(waiting, TODAY, 'ครับ')).toBe(
      'สวัสดีครับ พี่นก\nขอติดตามเรื่อง "ใบเสนอราคา ABC"ครับ ไม่ทราบว่าตอนนี้ความคืบหน้าเป็นอย่างไรบ้าง เพราะงานนี้ต้องส่งพรุ่งนี้\nขอบคุณครับ',
    )
    expect(followUpMessage(waiting, TODAY, '')).toContain('สวัสดี พี่นก')
  })

  it('markFollowedUp pushes the next follow-up 3 workdays out and counts as progress', () => {
    const next = markFollowedUp(waiting, thu, S.workdays)
    expect(next).toMatchObject({ status: 'waiting', followUpDate: '2026-09-29', lastProgressAt: thu.toISOString() })
    expect(loopFlags(next, TODAY, S).followUpDue).toBe(false)
  })
})

describe('notifications', () => {
  const on = { ...S, notify: true } // เริ่ม 09:00 เลิก 17:00
  const at = (h: number, m = 0, day = 24) => new Date(2026, 8, day, h, m)

  it('sends nothing when turned off, outside work hours, or on days off', () => {
    expect(pendingNotifications(at(10), S, {})).toEqual([])
    expect(pendingNotifications(at(8, 59), on, {})).toEqual([])
    expect(pendingNotifications(at(10, 0, 26), on, {})).toEqual([]) // เสาร์
    expect(pendingNotifications(at(19, 30), on, {})).toEqual([])
  })

  it('sends the morning brief once, then the end-of-day reminder once', () => {
    expect(pendingNotifications(at(9), on, {})).toEqual(['brief'])
    expect(pendingNotifications(at(16, 29), on, { brief: 'x' })).toEqual([])
    expect(pendingNotifications(at(16, 30), on, { brief: 'x' })).toEqual(['shutdown'])
    expect(pendingNotifications(at(18), on, { brief: 'x', shutdown: 'y' })).toEqual([])
    // เปิดแอปครั้งแรกตอนใกล้เลิกงาน: ไม่ต้องส่งสรุปเช้าแล้ว
    expect(pendingNotifications(at(16, 45), on, {})).toEqual(['shutdown'])
  })

  it('writes short Thai messages', () => {
    const loops = [mk('a', { horizon: 'today', estimateMinutes: 120 })]
    const load = computeDayLoad(loops, TODAY, S, 0)
    expect(briefMessage(load, nudgesFor(loops, TODAY, S)).body).toBe('วางงานไว้ 2 ชม. จากเวลาว่าง 7 ชม.')
    expect(shutdownMessage(2).body).toContain('ยังเปิดอยู่ 2 งาน')
    expect(shutdownMessage(0).body).toContain('เลิกงานได้เลย')
  })
})
