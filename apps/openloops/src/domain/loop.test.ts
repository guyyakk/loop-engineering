import { describe, expect, it } from 'vitest'
import {
  addStep,
  applyPlan,
  advance,
  applyDraft,
  createLoop,
  draftFromLoop,
  emptyDraft,
  groupLoops,
  newStep,
  planValueOf,
  nextStep,
  progress,
  scheduleOn,
  setHorizon,
  setStatus,
  startDay,
  toggleStep,
  validateDraft,
  validateWaiting,
  type Loop,
  type LoopDraft,
} from './loop'

const t0 = new Date('2026-09-24T02:00:00.000Z')
const t1 = new Date('2026-09-24T03:00:00.000Z')
const t2 = new Date('2026-09-24T04:00:00.000Z')

function draft(patch: Partial<LoopDraft> = {}): LoopDraft {
  return { ...emptyDraft(), title: 'ใบเสนอราคา ABC', ...patch }
}

function withSteps(...titles: string[]): Loop {
  return createLoop(draft({ steps: titles.map(newStep) }), t0, 'loop-1')
}

describe('validateDraft', () => {
  it('requires a non-blank title', () => {
    expect(validateDraft(draft({ title: '' })).title).toBeDefined()
    expect(validateDraft(draft({ title: '   ' })).title).toBeDefined()
    expect(validateDraft(draft())).toEqual({})
  })

  it('rejects overly long titles and non-positive estimates', () => {
    expect(validateDraft(draft({ title: 'ก'.repeat(201) })).title).toBeDefined()
    expect(validateDraft(draft({ estimateMinutes: 0 })).estimate).toBeDefined()
    expect(validateDraft(draft({ estimateMinutes: 30 }))).toEqual({})
  })
})

describe('createLoop', () => {
  it('creates an active loop from a title-only draft', () => {
    const loop = createLoop(draft({ title: '  ส่งรายงาน  ' }), t0, 'x')
    expect(loop).toMatchObject({
      id: 'x',
      title: 'ส่งรายงาน',
      project: null,
      status: 'active',
      horizon: 'week',
      steps: [],
      closedAt: null,
      rolloverCount: 0,
      lastProgressAt: t0.toISOString(),
    })
  })

  it('drops blank steps and trims project', () => {
    const loop = createLoop(draft({ project: '  ลูกค้า ABC ', steps: [newStep('ขอราคา'), newStep('  ')] }), t0)
    expect(loop.project).toBe('ลูกค้า ABC')
    expect(loop.steps.map((s) => s.title)).toEqual(['ขอราคา'])
  })

  it('refuses an invalid draft', () => {
    expect(() => createLoop(draft({ title: '' }), t0)).toThrow()
  })
})

describe('progress and nextStep', () => {
  it('reports the first unfinished step as next', () => {
    let loop = withSteps('ขอราคา', 'คำนวณ margin', 'ส่งลูกค้า')
    expect(progress(loop)).toEqual({ done: 0, total: 3 })
    expect(nextStep(loop)?.title).toBe('ขอราคา')

    loop = toggleStep(loop, loop.steps[0].id, t1)
    expect(progress(loop)).toEqual({ done: 1, total: 3 })
    expect(nextStep(loop)?.title).toBe('คำนวณ margin')
  })
})

describe('toggleStep', () => {
  it('records progress time when a step is ticked', () => {
    const loop = withSteps('a', 'b')
    const next = toggleStep(loop, loop.steps[0].id, t1)
    expect(next.steps[0].doneAt).toBe(t1.toISOString())
    expect(next.lastProgressAt).toBe(t1.toISOString())
    expect(next.status).toBe('active')
  })

  it('closes the loop as done when the last step is ticked', () => {
    let loop = withSteps('a', 'b')
    loop = toggleStep(loop, loop.steps[0].id, t1)
    loop = toggleStep(loop, loop.steps[1].id, t2)
    expect(loop.status).toBe('done')
    expect(loop.closedAt).toBe(t2.toISOString())
  })

  it('reopens a done loop when a step is unticked', () => {
    let loop = withSteps('a')
    loop = toggleStep(loop, loop.steps[0].id, t1)
    expect(loop.status).toBe('done')
    loop = toggleStep(loop, loop.steps[0].id, t2)
    expect(loop.status).toBe('active')
    expect(loop.closedAt).toBeNull()
    expect(loop.steps[0].doneAt).toBeNull()
  })

  it('ignores unknown step ids', () => {
    const loop = withSteps('a')
    expect(toggleStep(loop, 'nope', t1)).toBe(loop)
  })
})

describe('advance', () => {
  it('ticks the next step, or closes a loop without steps', () => {
    const stepped = advance(withSteps('a', 'b'), t1)
    expect(progress(stepped).done).toBe(1)

    const plain = advance(createLoop(draft(), t0), t1)
    expect(plain.status).toBe('done')
  })
})

describe('setStatus', () => {
  it('requires who and a follow-up date for waiting', () => {
    const loop = withSteps('a')
    expect(validateWaiting({ waitingOn: ' ', followUpDate: null })).toEqual({
      waitingOn: expect.any(String),
      followUpDate: expect.any(String),
    })
    expect(() => setStatus(loop, 'waiting', t1)).toThrow()
    expect(() => setStatus(loop, 'waiting', t1, { waitingOn: '', followUpDate: '2026-09-27' })).toThrow()

    const waiting = setStatus(loop, 'waiting', t1, { waitingOn: ' พี่นก ', followUpDate: '2026-09-27' })
    expect(waiting).toMatchObject({ status: 'waiting', waitingOn: 'พี่นก', followUpDate: '2026-09-27' })
  })

  it('clears waiting info when moving back to active', () => {
    const waiting = setStatus(withSteps('a'), 'waiting', t1, { waitingOn: 'พี่นก', followUpDate: '2026-09-27' })
    const active = setStatus(waiting, 'active', t2)
    expect(active).toMatchObject({ status: 'active', waitingOn: null, followUpDate: null })
  })

  it('keeps dropped and done loops with a close time, and can reopen them', () => {
    const dropped = setStatus(withSteps('a'), 'dropped', t1)
    expect(dropped).toMatchObject({ status: 'dropped', closedAt: t1.toISOString() })
    expect(dropped.steps).toHaveLength(1)

    const reopened = setStatus(dropped, 'blocked', t2)
    expect(reopened).toMatchObject({ status: 'blocked', closedAt: null })
  })
})

describe('editing', () => {
  it('applyDraft keeps status and step completion', () => {
    let loop = withSteps('a', 'b')
    loop = toggleStep(loop, loop.steps[0].id, t1)
    const d = draftFromLoop(loop)
    d.title = 'ชื่อใหม่'
    d.steps.push(newStep('c'))
    const edited = applyDraft(loop, d, t2)
    expect(edited.title).toBe('ชื่อใหม่')
    expect(edited.steps[0].doneAt).toBe(t1.toISOString())
    expect(edited.steps).toHaveLength(3)
    expect(edited.lastProgressAt).toBe(t1.toISOString())
  })

  it('addStep reopens a done loop', () => {
    const done = setStatus(withSteps('a'), 'done', t1)
    const next = addStep(done, 'ขั้นที่ลืมไป', t2)
    expect(next.status).toBe('active')
    expect(next.closedAt).toBeNull()
    expect(nextStep(next)?.title).toBe('a')
  })

  it('setHorizon moves the loop between sections', () => {
    expect(setHorizon(withSteps('a'), 'today', t1).horizon).toBe('today')
  })
})

describe('groupLoops', () => {
  it('groups by horizon, puts closed loops apart, and sorts actionable work first', () => {
    const mk = (id: string, patch: Partial<LoopDraft>, at = t0) => createLoop(draft({ title: id, ...patch }), at, id)
    const late = mk('late', { horizon: 'today', dueDate: '2026-09-30' })
    const soon = mk('soon', { horizon: 'today', dueDate: '2026-09-25' })
    const noDue = mk('nodue', { horizon: 'today' })
    const waiting = setStatus(mk('waiting', { horizon: 'today', dueDate: '2026-09-24' }), 'waiting', t1, {
      waitingOn: 'x',
      followUpDate: '2026-09-26',
    })
    const week = mk('week', { horizon: 'week' })
    const doneOld = setStatus(mk('done-old', { horizon: 'today' }), 'done', t1)
    const doneNew = setStatus(mk('done-new', { horizon: 'later' }), 'dropped', t2)

    const g = groupLoops([late, week, doneOld, waiting, noDue, doneNew, soon])
    expect(g.today.map((l) => l.id)).toEqual(['soon', 'late', 'nodue', 'waiting'])
    expect(g.week.map((l) => l.id)).toEqual(['week'])
    expect(g.later).toEqual([])
    expect(g.closed.map((l) => l.id)).toEqual(['done-new', 'done-old'])
  })
})

describe('planning across days', () => {
  const yesterday = new Date(2026, 8, 23, 10, 0)
  const today = new Date(2026, 8, 24, 9, 0)
  const TODAY = '2026-09-24'
  const plan = (title: string, horizon: LoopDraft['horizon'], at = today) => createLoop(draft({ title, horizon }), at, title)

  it('stamps the planned date when a loop enters today, and clears it when it leaves', () => {
    expect(plan('a', 'today').plannedDate).toBe(TODAY)
    expect(plan('a', 'week').plannedDate).toBeNull()

    const moved = setHorizon(plan('a', 'week'), 'today', today)
    expect(moved.plannedDate).toBe(TODAY)
    expect(setHorizon(moved, 'later', today).plannedDate).toBeNull()
    // เลือกช่วงเดิมซ้ำ ต้องไม่ล้างวันแผน
    expect(setHorizon(plan('a', 'today', yesterday), 'today', today).plannedDate).toBe('2026-09-23')
  })

  it('scheduling a loop out of today counts one postponement', () => {
    const next = scheduleOn(plan('a', 'today'), '2026-09-25', today)
    expect(next).toMatchObject({ horizon: 'week', plannedDate: '2026-09-25', rolloverCount: 1 })
  })

  it('startDay carries unfinished loops once, even when run again', () => {
    const stale = plan('stale', 'today', yesterday)
    const [carried] = startDay([stale], TODAY)
    expect(carried).toMatchObject({ horizon: 'today', plannedDate: TODAY, carriedOn: TODAY, rolloverCount: 1 })
    expect(startDay([carried], TODAY)).toEqual([])
  })

  it('startDay keeps waiting loops in today without counting a postponement', () => {
    const waiting = setStatus(plan('w', 'today', yesterday), 'waiting', yesterday, {
      waitingOn: 'พี่นก',
      followUpDate: '2026-09-27',
    })
    const [kept] = startDay([waiting], TODAY)
    expect(kept).toMatchObject({ status: 'waiting', plannedDate: TODAY, carriedOn: null, rolloverCount: 0 })
    expect(startDay([kept], TODAY)).toEqual([])
  })

  it('startDay brings postponed loops back on their day without counting again', () => {
    const postponed = scheduleOn(plan('p', 'today', yesterday), '2026-09-24', yesterday)
    expect(startDay([postponed], '2026-09-23')).toEqual([])
    const [back] = startDay([postponed], TODAY)
    expect(back).toMatchObject({ horizon: 'today', plannedDate: TODAY, carriedOn: null, rolloverCount: 1 })
  })

  it('startDay leaves closed, current, future and unplanned loops alone', () => {
    const closed = setStatus(plan('closed', 'today', yesterday), 'done', yesterday)
    const current = plan('current', 'today')
    const future = { ...plan('future', 'week'), plannedDate: '2026-09-30' }
    const unplanned = plan('unplanned', 'week')
    expect(startDay([closed, current, future, unplanned], TODAY)).toEqual([])
  })

  it('reopening a closed loop in today does not count as a carry-over', () => {
    const done = setStatus(plan('a', 'today', yesterday), 'done', yesterday)
    const reopened = setStatus(done, 'active', today)
    expect(reopened.plannedDate).toBe(TODAY)
    expect(startDay([reopened], TODAY)).toEqual([])
  })
})

describe('week planning (spec 3)', () => {
  // 2026-09-24 เป็นวันพฤหัสบดี, 26 = เสาร์, 27 = อาทิตย์, 28 = จันทร์
  const thu = new Date(2026, 8, 24, 9, 0)
  const TODAY = '2026-09-24'
  const WORKDAYS = [1, 2, 3, 4, 5]
  const plan = (title: string, horizon: LoopDraft['horizon'], at = thu) => createLoop(draft({ title, horizon }), at, title)

  it('scheduleOn: today joins today, future days keep the date, the past is refused', () => {
    expect(scheduleOn(plan('a', 'week'), TODAY, thu)).toMatchObject({ horizon: 'today', plannedDate: TODAY, rolloverCount: 0 })
    expect(scheduleOn(plan('a', 'week'), '2026-09-28', thu)).toMatchObject({ horizon: 'week', plannedDate: '2026-09-28', rolloverCount: 0 })
    expect(() => scheduleOn(plan('a', 'week'), '2026-09-23', thu)).toThrow()
  })

  it('moving between future days or back to the tray does not count as postponing', () => {
    const fri = scheduleOn(plan('a', 'week'), '2026-09-25', thu)
    const mon = scheduleOn(fri, '2026-09-28', thu)
    expect(mon.rolloverCount).toBe(0)
    const tray = setHorizon(plan('b', 'today'), 'later', thu)
    expect(tray).toMatchObject({ horizon: 'later', plannedDate: null, rolloverCount: 0 })
    expect(setHorizon(mon, 'week', thu).plannedDate).toBeNull()
  })

  it('applyPlan and planValueOf round-trip every choice', () => {
    const loop = plan('a', 'week')
    for (const value of [TODAY, '2026-09-26', 'week', 'later'] as const) {
      expect(planValueOf(applyPlan(loop, value, thu), TODAY)).toBe(value)
    }
  })

  it('editing a scheduled loop keeps its day when the horizon is unchanged', () => {
    const scheduled = scheduleOn(plan('a', 'week'), '2026-09-28', thu)
    const edited = applyDraft(scheduled, { ...draftFromLoop(scheduled), title: 'ชื่อใหม่' }, thu)
    expect(edited.plannedDate).toBe('2026-09-28')
  })

  it('startDay does not carry or count on non-workdays, then carries once on the next workday', () => {
    const friday = plan('friday', 'today', new Date(2026, 8, 25, 9, 0))
    expect(startDay([friday], '2026-09-26', WORKDAYS)).toEqual([])
    expect(startDay([friday], '2026-09-27', WORKDAYS)).toEqual([])
    const [monday] = startDay([friday], '2026-09-28', WORKDAYS)
    expect(monday).toMatchObject({ plannedDate: '2026-09-28', carriedOn: '2026-09-28', carriedFrom: '2026-09-25', rolloverCount: 1 })
  })

  it('startDay still brings loops scheduled for a weekend day into today', () => {
    const saturday = scheduleOn(plan('sat', 'week'), '2026-09-26', thu)
    const [pulled] = startDay([saturday], '2026-09-26', WORKDAYS)
    expect(pulled).toMatchObject({ horizon: 'today', plannedDate: '2026-09-26', rolloverCount: 0 })
  })

  it('groupLoops places scheduled loops by date: this week vs later', () => {
    const thisWeek = scheduleOn(plan('sun', 'later'), '2026-09-27', thu)
    const nextWeek = scheduleOn(plan('mon', 'week'), '2026-09-28', thu)
    const g = groupLoops([thisWeek, nextWeek], TODAY)
    expect(g.week.map((l) => l.id)).toEqual(['sun'])
    expect(g.later.map((l) => l.id)).toEqual(['mon'])
  })
})
