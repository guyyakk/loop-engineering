import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, buildWeek, computeDayLoad, freeMinutes, loadForDay, remainingMinutes, suggestPostpone } from './capacity'
import { createLoop, emptyDraft, newStep, scheduleOn, setStatus, toggleStep, type Loop, type LoopDraft } from './loop'

const TODAY = '2026-09-24'
const morning = new Date(2026, 8, 24, 9, 0)

function mk(title: string, patch: Partial<LoopDraft> = {}): Loop {
  return createLoop({ ...emptyDraft('today'), title, ...patch }, morning, title)
}

const titles = (loops: Loop[]) => loops.map((l) => l.title)

describe('remainingMinutes', () => {
  it('scales the estimate by the steps still open', () => {
    expect(remainingMinutes(mk('a'))).toBeNull()
    expect(remainingMinutes(mk('a', { estimateMinutes: 90 }))).toBe(90)

    let loop = mk('a', { estimateMinutes: 120, steps: ['1', '2', '3', '4'].map(newStep) })
    loop = toggleStep(loop, loop.steps[0].id, morning)
    expect(remainingMinutes(loop)).toBe(90)
  })
})

describe('freeMinutes', () => {
  it('is work time minus meetings minus buffer, never below zero', () => {
    expect(freeMinutes(DEFAULT_SETTINGS, 90)).toBe(330)
    expect(freeMinutes({ workMinutes: 360, bufferMinutes: 60 }, 400)).toBe(0)
  })
})

describe('computeDayLoad', () => {
  it('counts only open, estimated, non-waiting loops planned for today', () => {
    const loops = [
      mk('counted', { estimateMinutes: 120 }),
      setStatus(mk('waiting', { estimateMinutes: 60 }), 'waiting', morning, { waitingOn: 'x', followUpDate: '2026-09-25' }),
      mk('unestimated'),
      mk('week', { horizon: 'week', estimateMinutes: 240 }),
      setStatus(mk('done-today', { estimateMinutes: 30 }), 'done', new Date(2026, 8, 24, 11, 0)),
      setStatus(mk('done-yesterday', { estimateMinutes: 30 }), 'done', new Date(2026, 8, 23, 17, 0)),
    ]
    const load = computeDayLoad(loops, TODAY, DEFAULT_SETTINGS, 90)
    expect(load.freeMinutes).toBe(330)
    expect(load.plannedMinutes).toBe(120)
    expect(load.diffMinutes).toBe(210)
    expect(load.tone).toBe('ok')
    expect(titles(load.counted)).toEqual(['counted'])
    expect(titles(load.unestimated)).toEqual(['unestimated'])
    expect(titles(load.waiting)).toEqual(['waiting'])
    expect(load.doneToday).toBe(1)
  })

  it('reports empty, tight and over', () => {
    const settings = { ...DEFAULT_SETTINGS, workMinutes: 480, bufferMinutes: 60 } // ว่าง 420 เมื่อไม่มีประชุม
    expect(computeDayLoad([], TODAY, settings, 0).tone).toBe('empty')
    expect(computeDayLoad([mk('a', { estimateMinutes: 240 })], TODAY, settings, 0).tone).toBe('ok')

    const tight = computeDayLoad([mk('a', { estimateMinutes: 240 }), mk('b', { estimateMinutes: 120 })], TODAY, settings, 0)
    expect(tight.tone).toBe('tight')
    expect(tight.diffMinutes).toBe(60)

    const over = computeDayLoad([mk('a', { estimateMinutes: 240 }), mk('b', { estimateMinutes: 240 })], TODAY, settings, 0)
    expect(over.tone).toBe('over')
    expect(over.diffMinutes).toBe(-60)
  })

  it('counts loops carried into today', () => {
    const carried = { ...mk('a', { estimateMinutes: 30 }), carriedOn: TODAY, rolloverCount: 1 }
    expect(computeDayLoad([carried, mk('b')], TODAY, DEFAULT_SETTINGS, 0).carriedToday).toBe(1)
  })
})

describe('suggestPostpone', () => {
  const big = mk('big-nodue', { estimateMinutes: 240 })
  const small = mk('small-nodue', { estimateMinutes: 30 })
  const urgent = mk('due-today', { estimateMinutes: 60, dueDate: TODAY })
  const overdue = mk('overdue', { estimateMinutes: 60, dueDate: '2026-09-20' })
  const later = mk('due-later', { estimateMinutes: 60, dueDate: '2026-09-30' })
  const all = [urgent, later, big, overdue, small]

  it('picks the smallest flexible loop that covers the overflow', () => {
    expect(titles(suggestPostpone(all, 30, TODAY))).toEqual(['small-nodue'])
    expect(titles(suggestPostpone(all, 200, TODAY))).toEqual(['big-nodue'])
  })

  it('moves to later due dates only after no-due loops are used up', () => {
    expect(titles(suggestPostpone(all, 300, TODAY))).toEqual(['big-nodue', 'small-nodue', 'due-later'])
  })

  it('never suggests loops due today or overdue', () => {
    const picked = titles(suggestPostpone(all, 10_000, TODAY))
    expect(picked).not.toContain('due-today')
    expect(picked).not.toContain('overdue')
    expect(suggestPostpone(all, 0, TODAY)).toEqual([])
  })
})

describe('week plan (spec 3)', () => {
  // สัปดาห์ 21–27 ก.ย. 2026, วันนี้พฤหัสบดี 24
  const WEEK = '2026-09-21'
  const at = (title: string, date: string, estimateMinutes = 60) =>
    scheduleOn(mk(title, { horizon: 'week', estimateMinutes }), date, morning)

  it('treats non-workdays as off: no free time and never "over"', () => {
    const saturday = at('sat', '2026-09-26', 120)
    const load = loadForDay([saturday], '2026-09-26', TODAY, DEFAULT_SETTINGS, 0)
    expect(load).toMatchObject({ tone: 'off', freeMinutes: 0, plannedMinutes: 120 })
  })

  it('uses each day meeting time and its own scheduled loops', () => {
    const friday = [at('f1', '2026-09-25', 240), at('f2', '2026-09-25', 180)]
    const load = loadForDay(friday, '2026-09-25', TODAY, DEFAULT_SETTINGS, 120)
    expect(load).toMatchObject({ freeMinutes: 300, plannedMinutes: 420, tone: 'over' })
  })

  it('builds 7 days, the unscheduled tray and totals from today on', () => {
    const loops = [
      mk('today-a', { estimateMinutes: 120 }),
      at('fri', '2026-09-25', 60),
      at('next-mon', '2026-09-28', 60),
      mk('tray-week', { horizon: 'week' }),
      mk('tray-later', { horizon: 'later' }),
      setStatus(mk('done-tue', {}), 'done', new Date(2026, 8, 22, 15, 0)),
    ]
    const plan = buildWeek(loops, WEEK, TODAY, DEFAULT_SETTINGS, { '2026-09-25': 60 })
    expect(plan.days.map((d) => d.date)).toEqual([
      '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27',
    ])
    const byDate = Object.fromEntries(plan.days.map((d) => [d.date, d]))
    expect(byDate['2026-09-22']).toMatchObject({ isPast: true, loops: [] })
    expect(byDate['2026-09-22'].load.doneToday).toBe(1)
    expect(titles(byDate['2026-09-24'].loops)).toEqual(['today-a'])
    expect(titles(byDate['2026-09-25'].loops)).toEqual(['fri'])
    expect(byDate['2026-09-25'].load.freeMinutes).toBe(360)
    expect(byDate['2026-09-26'].isWorkday).toBe(false)
    expect(titles(plan.tray.week)).toEqual(['tray-week'])
    expect(titles(plan.tray.later)).toEqual(['tray-later'])
    // วันนี้ 420 + ศุกร์ 360 (ประชุม 1 ชม.) + เสาร์อาทิตย์ 0
    expect(plan.freeMinutes).toBe(780)
    expect(plan.plannedMinutes).toBe(180)
  })
})
