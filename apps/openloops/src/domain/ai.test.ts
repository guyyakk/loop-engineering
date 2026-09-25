import { describe, expect, it } from 'vitest'
import {
  AiError,
  PLAN_MAX_LOOPS,
  applyAiPlan,
  applyCapture,
  breakdownRequest,
  calendarLines,
  captureRequest,
  cleanEstimate,
  errorFromResponse,
  messagesBody,
  parseBreakdown,
  parseCapture,
  parsePlan,
  planChangeIds,
  planPool,
  planRequest,
  toolInput,
  validateApiKey,
  type CaptureContext,
} from './ai'
import { DEFAULT_SETTINGS, computeDayLoad } from './capacity'
import { createLoop, emptyDraft, newStep, setStatus, type Loop, type LoopDraft } from './loop'

const today = '2026-09-25' // ศุกร์
const now = new Date(2026, 8, 25, 9)
const ctx: CaptureContext = { today, workdays: [1, 2, 3, 4, 5], projects: ['ลูกค้า ABC'] }

function mk(title: string, patch: Partial<LoopDraft> = {}, loopPatch: Partial<Loop> = {}): Loop {
  return { ...createLoop({ ...emptyDraft('week'), title, ...patch }, now, `id-${title}`), ...loopPatch }
}

describe('api key', () => {
  it('accepts Claude keys only', () => {
    expect(validateApiKey('')).toBeTruthy()
    expect(validateApiKey('sk-proj-abcdefghijklmnopqrstuvwxyz')).toBeTruthy()
    expect(validateApiKey('sk-ant-short')).toBeTruthy()
    expect(validateApiKey('  sk-ant-api03-abcdefghijklmnopqrstuvwxyz_0123-XYZ  ')).toBeNull()
  })
})

describe('messages api', () => {
  const request = breakdownRequest({ title: 'ทำรายงาน', project: null, estimateMinutes: null, steps: [] })

  it('forces the answer through the tool', () => {
    const body = messagesBody('claude-opus-5-5', request)
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: request.maxTokens,
      tools: [request.tool],
      tool_choice: { type: 'tool', name: 'suggest_steps' },
      messages: [{ role: 'user', content: request.prompt }],
    })
  })

  it('reads the tool input, and treats a cut-off or tool-less answer as incomplete', () => {
    const ok = { content: [{ type: 'text', text: 'x' }, { type: 'tool_use', name: 'suggest_steps', input: { steps: ['a'] } }] }
    expect(toolInput(ok, 'suggest_steps')).toEqual({ steps: ['a'] })
    expect(() => toolInput({ ...ok, stop_reason: 'max_tokens' }, 'suggest_steps')).toThrow(AiError)
    expect(() => toolInput({ content: [{ type: 'text', text: 'x' }] }, 'suggest_steps')).toThrow(AiError)
    expect(() => toolInput(null, 'suggest_steps')).toThrow(AiError)
  })

  it('maps API errors to kinds the user can act on', () => {
    expect(errorFromResponse(401, null)).toBe('bad-key')
    expect(errorFromResponse(403, null)).toBe('forbidden')
    expect(errorFromResponse(404, null)).toBe('model')
    expect(errorFromResponse(429, null)).toBe('rate-limit')
    expect(errorFromResponse(400, { error: { message: 'Your credit balance is too low to access the API' } })).toBe('credit')
    expect(errorFromResponse(529, null)).toBe('overloaded')
    expect(errorFromResponse(400, { error: { message: 'bad' } })).toBe('request')
  })
})

describe('capture from a sentence', () => {
  it('gives the model a calendar to resolve Thai relative dates', () => {
    const lines = calendarLines(today).split('\n')
    expect(lines[0]).toBe('2026-09-25 ศุกร์ (วันนี้)')
    expect(lines[1]).toBe('2026-09-26 เสาร์ (พรุ่งนี้)')
    expect(lines[3]).toBe('2026-09-28 จันทร์ (สัปดาห์หน้า)')
    expect(lines).toHaveLength(14)
    const req = captureRequest('  พรุ่งนี้ส่งใบเสนอราคา  ', ctx)
    expect(req.prompt).toContain('ลูกค้า ABC')
    expect(req.prompt).toContain('ประโยคของผู้ใช้:\nพรุ่งนี้ส่งใบเสนอราคา')
    expect(req.prompt).toContain('วันทำงาน: จันทร์, อังคาร, พุธ, พฤหัสบดี, ศุกร์')
  })

  it('keeps only valid fields and derives the horizon from the due date', () => {
    const s = parseCapture(
      {
        title: '  ส่งใบเสนอราคา   ลูกค้า ABC ',
        horizon: 'someday',
        due_date: '2026-09-27',
        estimate_minutes: 93,
        energy: 'medium',
        project: 'ลูกค้า abc',
        steps: ['1. ขอราคา', 'ขอราคา', '', 42, 'ส่งอีเมล'],
      },
      ctx,
    )
    expect(s).toEqual({
      title: 'ส่งใบเสนอราคา ลูกค้า ABC',
      horizon: 'week',
      dueDate: '2026-09-27',
      estimateMinutes: 95,
      energy: null,
      project: 'ลูกค้า ABC',
      steps: ['ขอราคา', 'ส่งอีเมล'],
    })
  })

  it('drops past or impossible dates, and needs a title', () => {
    expect(parseCapture({ title: 'a', due_date: '2026-09-24' }, ctx).dueDate).toBeNull()
    expect(parseCapture({ title: 'a', due_date: '2026-02-31' }, ctx).dueDate).toBeNull()
    expect(parseCapture({ title: 'a', due_date: '2026-10-10' }, ctx).horizon).toBe('later')
    expect(parseCapture({ title: 'a', due_date: today }, ctx).horizon).toBe('today')
    expect(parseCapture({ title: 'a', horizon: 'today' }, ctx).horizon).toBe('today')
    expect(() => parseCapture({ title: '  ' }, ctx)).toThrow(AiError)
  })

  it('rounds estimates to 5 minutes within 5 minutes to 40 hours', () => {
    expect(cleanEstimate(2)).toBe(5)
    expect(cleanEstimate(90)).toBe(90)
    expect(cleanEstimate(99999)).toBe(2400)
    expect(cleanEstimate(0)).toBeNull()
    expect(cleanEstimate('60')).toBeNull()
  })

  it('fills the form but keeps what the AI left empty, and appends new steps', () => {
    const draft: LoopDraft = { ...emptyDraft('today'), title: 'ประโยคยาว', energy: 'deep', steps: [newStep('ขอราคา')] }
    const next = applyCapture(draft, {
      title: 'ส่งใบเสนอราคา',
      horizon: null,
      dueDate: '2026-09-28',
      estimateMinutes: null,
      energy: null,
      project: null,
      steps: ['ขอราคา', 'ส่งลูกค้า'],
    })
    expect(next).toMatchObject({ title: 'ส่งใบเสนอราคา', horizon: 'today', dueDate: '2026-09-28', energy: 'deep', project: '' })
    expect(next.steps.map((s) => s.title)).toEqual(['ขอราคา', 'ส่งลูกค้า'])
  })
})

describe('break down into steps', () => {
  it('sends existing steps and returns only new ones', () => {
    const req = breakdownRequest({ title: 'ทำคู่มือ', project: 'HR', estimateMinutes: 240, steps: ['ร่างหัวข้อ'] })
    expect(req.prompt).toContain('ขั้นที่มีอยู่แล้ว:\n1. ร่างหัวข้อ')
    expect(req.prompt).toContain('โปรเจกต์: HR')
    expect(parseBreakdown({ steps: ['ร่างหัวข้อ', 'เขียนบทที่ 1', 'เขียนบทที่ 1'] }, ['ร่างหัวข้อ'])).toEqual(['เขียนบทที่ 1'])
    expect(parseBreakdown({ steps: Array.from({ length: 12 }, (_, i) => `ขั้น ${i}`) }, [])).toHaveLength(8)
    expect(() => parseBreakdown({ steps: ['ร่างหัวข้อ'] }, ['ร่างหัวข้อ'])).toThrow(AiError)
    expect(() => parseBreakdown({}, [])).toThrow(AiError)
  })
})

describe('morning plan', () => {
  const inToday = mk('รายงาน', { horizon: 'today', estimateMinutes: 120, energy: 'deep' })
  const dueToday = mk('ส่งสัญญา', { horizon: 'today', estimateMinutes: 60, dueDate: today })
  const tray = mk('ใบเสนอราคา', { estimateMinutes: 60, dueDate: '2026-09-28' })
  const later = mk('จัดตู้', { horizon: 'later' })
  const waiting = setStatus(mk('รอพี่นก', { horizon: 'today' }), 'waiting', now, { waitingOn: 'พี่นก', followUpDate: '2026-09-29' })
  const done = setStatus(mk('เสร็จแล้ว'), 'done', now)
  const loops = [later, tray, inToday, dueToday, waiting, done]
  const load = computeDayLoad(loops, today, DEFAULT_SETTINGS, 0)
  const planCtx = { today, settings: DEFAULT_SETTINGS, load, postponeDate: '2026-09-28' }

  it('sends open, non-waiting loops with short refs, today first', () => {
    expect(planPool(loops).map((l) => l.title)).toEqual(['ส่งสัญญา', 'รายงาน', 'ใบเสนอราคา', 'จัดตู้'])
    const many = Array.from({ length: 60 }, (_, i) => mk(`งาน ${i}`))
    expect(planPool(many)).toHaveLength(PLAN_MAX_LOOPS)

    const { request, refs } = planRequest(loops, planCtx)
    expect(Object.keys(refs)).toEqual(['L1', 'L2', 'L3', 'L4'])
    expect(refs.L1).toBe(dueToday)
    expect(request.prompt).toContain(`free_minutes วันนี้ (หักประชุม ปฏิทิน และเวลาเผื่อแล้ว): ${load.freeMinutes}`)
    expect(request.prompt).toContain('"flags":["due today","must start now to meet due date"]')
    expect(request.prompt).not.toContain(inToday.id)
    expect(request.prompt).not.toContain('รอพี่นก')
  })

  it('filters suggestions that break the rules', () => {
    const { refs } = planRequest(loops, planCtx)
    const plan = parsePlan(
      {
        summary: 'วันนี้เน้นงานที่ต้องส่ง',
        today: [
          { ref: 'L1', reason: 'ส่งวันนี้' },
          { ref: 'L3', reason: 'ส่งจันทร์' },
          { ref: 'L3', reason: 'ซ้ำ' },
          { ref: 'L99', reason: 'ไม่มีจริง' },
        ],
        postpone: [
          { ref: 'L2', reason: 'ไม่พอเวลา' },
          { ref: 'L1', reason: 'ขัดกัน' },
          { ref: 'L4', reason: 'ไม่ได้อยู่ในวันนี้' },
        ],
      },
      refs,
      today,
    )
    expect(plan.order.map((i) => [i.loop.title, i.pull])).toEqual([
      ['ส่งสัญญา', false],
      ['ใบเสนอราคา', true],
    ])
    expect(plan.postpone.map((p) => p.loop.title)).toEqual(['รายงาน'])
    expect(plan.ignored).toBe(4)
    expect(planChangeIds(plan)).toEqual([tray.id, inToday.id])
    expect(() => parsePlan({ summary: 'x' }, refs, today)).toThrow(AiError)
  })

  it('never postpones work that is due today or overdue', () => {
    const { refs } = planRequest(loops, planCtx)
    const plan = parsePlan({ summary: '', today: [], postpone: [{ ref: 'L1', reason: 'x' }] }, refs, today)
    expect(plan.postpone).toEqual([])
    expect(plan.ignored).toBe(1)
  })

  it('applies only the chosen moves to the latest data', () => {
    const { refs } = planRequest(loops, planCtx)
    const plan = parsePlan(
      { summary: '', today: [{ ref: 'L3', reason: '' }, { ref: 'L4', reason: '' }], postpone: [{ ref: 'L2', reason: '' }] },
      refs,
      today,
    )
    // จัดตู้ถูกปิดไปแล้วระหว่างรอ AI
    const current = loops.map((l) => (l.id === later.id ? setStatus(l, 'dropped', now) : l))
    const all = new Set(planChangeIds(plan))
    const { changed, previous } = applyAiPlan(current, plan, all, now, '2026-09-28')
    expect(changed.map((l) => [l.title, l.horizon, l.plannedDate, l.rolloverCount])).toEqual([
      ['ใบเสนอราคา', 'today', today, 0],
      ['รายงาน', 'week', '2026-09-28', 1],
    ])
    expect(previous).toEqual([tray, inToday])

    const onlyPull = applyAiPlan(current, plan, new Set([tray.id]), now, '2026-09-28')
    expect(onlyPull.changed.map((l) => l.title)).toEqual(['ใบเสนอราคา'])
  })
})
