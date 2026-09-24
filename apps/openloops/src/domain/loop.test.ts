import { describe, expect, it } from 'vitest'
import {
  addStep,
  advance,
  applyDraft,
  createLoop,
  draftFromLoop,
  emptyDraft,
  groupLoops,
  newStep,
  nextStep,
  progress,
  setHorizon,
  setStatus,
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
