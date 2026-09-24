import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, loadForDay, suggestPostpone } from './capacity'
import { createLoop, emptyDraft, newStep, setStatus, toggleStep, type Loop, type LoopDraft } from './loop'
import {
  applyDecision,
  applyDecisions,
  countDecisions,
  decisionError,
  defaultShutdownDecision,
  defaultTargetWeek,
  insertNextStep,
  planCandidates,
  plannableDays,
  reviewCandidates,
  reviewDue,
  shutdownCandidates,
  weekSummary,
  type DecisionContext,
} from './rituals'

// 2026-09-24 = พฤหัสบดี, วันทำงานถัดไป = ศุกร์ 25
const TODAY = '2026-09-24'
const thu = new Date(2026, 8, 24, 17, 0)
const S = DEFAULT_SETTINGS
const ctx: DecisionContext = { now: thu, nextWorkday: '2026-09-25', workdays: S.workdays }

function mk(title: string, patch: Partial<LoopDraft> = {}, extra: Partial<Loop> = {}, at = thu): Loop {
  return { ...createLoop({ ...emptyDraft('today'), title, ...patch }, at, title), ...extra }
}

const titles = (loops: Loop[]) => loops.map((l) => l.title)

describe('shutdown', () => {
  it('asks about open loops in today, except waiting ones', () => {
    const loops = [
      mk('a'),
      mk('b', { horizon: 'week' }),
      setStatus(mk('wait'), 'waiting', thu, { waitingOn: 'x', followUpDate: '2026-09-28' }),
      setStatus(mk('done'), 'done', thu),
    ]
    expect(titles(shutdownCandidates(loops))).toEqual(['a'])
  })

  it('defaults to carrying normal loops and forces a choice for repeatedly postponed ones', () => {
    expect(defaultShutdownDecision(mk('fresh', {}, { rolloverCount: 1 }))).toEqual({ kind: 'carry' })
    expect(defaultShutdownDecision(mk('chronic', {}, { rolloverCount: 2 }))).toBeNull()
    expect(decisionError(null)).toBeTruthy()
    expect(decisionError({ kind: 'split', firstStep: ' ', carry: true })).toBeTruthy()
    expect(decisionError({ kind: 'delegate', to: '' })).toBeTruthy()
    expect(decisionError({ kind: 'drop' })).toBeNull()
  })

  it('applies each decision', () => {
    const loop = mk('x', {}, { rolloverCount: 2 })
    expect(applyDecision(loop, { kind: 'done' }, ctx).status).toBe('done')
    expect(applyDecision(loop, { kind: 'drop' }, ctx).status).toBe('dropped')
    expect(applyDecision(loop, { kind: 'carry' }, ctx)).toMatchObject({ horizon: 'week', plannedDate: '2026-09-25', rolloverCount: 3 })
    expect(applyDecision(loop, { kind: 'tray', horizon: 'later' }, ctx)).toMatchObject({ horizon: 'later', plannedDate: null, rolloverCount: 2 })
    expect(applyDecision(loop, { kind: 'keep' }, ctx)).toBe(loop)
    expect(applyDecision(loop, { kind: 'delegate', to: ' น้องบี ' }, ctx)).toMatchObject({
      status: 'waiting',
      waitingOn: 'น้องบี',
      followUpDate: '2026-09-29',
    })
  })

  it('split inserts the new step before the first unfinished one', () => {
    let loop = mk('s', { steps: ['a', 'b', 'c'].map(newStep) })
    loop = toggleStep(loop, loop.steps[0].id, thu)
    const split = insertNextStep(loop, 'เปิดไฟล์', thu)
    expect(split.steps.map((s) => s.title)).toEqual(['a', 'เปิดไฟล์', 'b', 'c'])
    const carried = applyDecision(loop, { kind: 'split', firstStep: 'เปิดไฟล์', carry: true }, ctx)
    expect(carried).toMatchObject({ plannedDate: '2026-09-25' })
    expect(carried.steps[1].title).toBe('เปิดไฟล์')
  })

  it('applyDecisions only changes open loops with valid decisions and keeps the before-state for undo', () => {
    const a = mk('a')
    const b = mk('b')
    const c = setStatus(mk('c'), 'done', thu)
    const result = applyDecisions([a, b, c], { a: { kind: 'carry' }, b: { kind: 'split', firstStep: '', carry: true }, c: { kind: 'drop' } }, ctx)
    expect(titles(result.changed)).toEqual(['a'])
    expect(result.previous).toEqual([a])
    expect(countDecisions([a, b, c], { a: { kind: 'carry' }, c: { kind: 'drop' } })).toEqual({ carry: 1 })
  })

  it('previews the next workday load from the decisions', () => {
    const big = mk('big', { estimateMinutes: 240 })
    const small = mk('small', { estimateMinutes: 60 })
    const { next } = applyDecisions([big, small], { big: { kind: 'carry' }, small: { kind: 'tray', horizon: 'week' } }, ctx)
    expect(loadForDay(next, '2026-09-25', TODAY, S, 0).plannedMinutes).toBe(240)
  })
})

describe('weekly review', () => {
  const monday = new Date(2026, 8, 21, 10, 0)

  it('summarises the week: closed loops, time done, shutdown days and chronic loops', () => {
    const loops = [
      setStatus(mk('d1', { estimateMinutes: 60 }), 'done', monday),
      setStatus(mk('d2', { estimateMinutes: 120 }), 'done', thu),
      setStatus(mk('dropped'), 'dropped', thu),
      setStatus(mk('last-week'), 'done', new Date(2026, 8, 18, 10, 0)),
      mk('chronic', {}, { rolloverCount: 3 }),
    ]
    const s = weekSummary(loops, TODAY, S, ['2026-09-21', '2026-09-23', '2026-09-18'])
    expect(titles(s.done)).toEqual(['d1', 'd2'])
    expect(titles(s.dropped)).toEqual(['dropped'])
    expect(s.doneMinutes).toBe(180)
    expect(s.shutdownDays).toBe(2)
    expect(s.workdaysSoFar).toBe(4)
    expect(titles(s.chronic)).toEqual(['chronic'])
  })

  it('brings up overdue, stalled and repeatedly postponed loops with a reason', () => {
    const lastWeek = new Date(2026, 8, 17, 10, 0)
    const loops = [
      mk('overdue', { horizon: 'week', dueDate: '2026-09-22' }),
      mk('stalled', { horizon: 'week' }, {}, lastWeek),
      mk('chronic', { horizon: 'week' }, { rolloverCount: 4 }),
      mk('fine', { horizon: 'week' }),
      setStatus(mk('waiting', { dueDate: '2026-09-22' }), 'waiting', thu, { waitingOn: 'x', followUpDate: '2026-09-28' }),
    ]
    const items = reviewCandidates(loops, TODAY, S)
    expect(items.map((i) => `${i.loop.title}: ${i.reason}`)).toEqual([
      'overdue: เลยกำหนด 2 วัน',
      'stalled: นิ่ง 5 วันทำการ',
      'chronic: เลื่อนมา 4 ครั้ง',
    ])
  })

  it('plans unscheduled tray loops, week tray first, skipping handled and waiting ones', () => {
    const loops = [
      mk('later', { horizon: 'later' }),
      mk('week', { horizon: 'week' }),
      mk('today'),
      { ...mk('scheduled', { horizon: 'week' }), plannedDate: '2026-09-29' },
      mk('handled', { horizon: 'week' }),
    ]
    expect(titles(planCandidates(loops, new Set(['handled'])))).toEqual(['week', 'later'])
  })

  it('targets next week from Thursday on, and only offers future workdays', () => {
    expect(defaultTargetWeek('2026-09-22')).toBe('2026-09-21')
    expect(defaultTargetWeek('2026-09-24')).toBe('2026-09-28')
    expect(defaultTargetWeek('2026-09-27')).toBe('2026-09-28')
    expect(plannableDays('2026-09-21', TODAY, S)).toEqual(['2026-09-24', '2026-09-25'])
  })

  it('prompts for the review from the last workday until it is done that week', () => {
    expect(reviewDue('2026-09-24', S, [])).toBe(false)
    expect(reviewDue('2026-09-25', S, [])).toBe(true)
    expect(reviewDue('2026-09-26', S, [])).toBe(true)
    expect(reviewDue('2026-09-25', S, ['2026-09-25'])).toBe(false)
    expect(reviewDue('2026-09-25', S, ['2026-09-18'])).toBe(true)
  })
})

describe('postpone suggestions avoid repeatedly postponed loops', () => {
  it('uses fresh loops first and chronic ones only when needed', () => {
    const chronic = mk('chronic', { estimateMinutes: 60 }, { rolloverCount: 2 })
    const fresh = mk('fresh', { estimateMinutes: 120 })
    expect(titles(suggestPostpone([chronic, fresh], 60, TODAY))).toEqual(['fresh'])
    expect(titles(suggestPostpone([chronic, fresh], 150, TODAY))).toEqual(['fresh', 'chronic'])
  })
})
