import { remainingMinutes, type DayLoad, type PlannerSettings } from './capacity'
import { addDays, fromDateKey, startOfWeek, toDateKey, weekdayOf, type DateKey } from './dates'
import {
  TITLE_MAX,
  compareOpen,
  isClosed,
  newStep,
  nextStep,
  progress,
  scheduleOn,
  setHorizon,
  type Energy,
  type Horizon,
  type Loop,
  type LoopDraft,
} from './loop'
import { loopFlags } from './nudges'

// ผู้ช่วย AI เป็นแค่ผู้เสนอ: ผลลัพธ์ทุกชิ้นผ่านการตรวจที่นี่ก่อน และผู้ใช้ต้องกดยืนยันเองเสมอ

export const MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
export const API_VERSION = '2023-06-01'
export const AI_TIMEOUT_MS = 60_000

export interface AiModel {
  id: string
  label: string
  note: string
}

export const AI_MODELS: AiModel[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', note: 'คิดละเอียดที่สุด' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', note: 'เร็วและคุ้ม' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', note: 'เร็วสุด ถูกสุด' },
]

export const DEFAULT_AI_MODEL = AI_MODELS[0].id

/** ค่าที่อยู่เฉพาะเครื่องนี้ ไม่อยู่ในไฟล์สำรอง */
export interface AiConfig {
  apiKey: string | null
  model: string
}

export const DEFAULT_AI_CONFIG: AiConfig = { apiKey: null, model: DEFAULT_AI_MODEL }

export function validateApiKey(value: string): string | null {
  const key = value.trim()
  if (!key) return 'วาง API key ก่อน'
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return 'รูปแบบไม่ใช่ Claude API key (ขึ้นต้นด้วย sk-ant-)'
  return null
}

/** แสดง key แบบไม่เปิดเผย */
export function maskKey(key: string): string {
  return `sk-ant-…${key.slice(-4)}`
}

// ---------- ข้อผิดพลาด ----------

export type AiErrorKind =
  | 'bad-key'
  | 'forbidden'
  | 'model'
  | 'credit'
  | 'rate-limit'
  | 'overloaded'
  | 'request'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'bad-output'

export class AiError extends Error {
  constructor(readonly kind: AiErrorKind) {
    super(kind)
    this.name = 'AiError'
  }
}

export function aiErrorText(kind: AiErrorKind): string {
  switch (kind) {
    case 'bad-key':
      return 'API key ใช้ไม่ได้ ตรวจว่าคัดลอกมาครบ หรือ key ถูกลบไปแล้วหรือไม่'
    case 'forbidden':
      return 'key นี้ไม่มีสิทธิ์ใช้งาน ตรวจสิทธิ์ของ key ใน Claude Console'
    case 'model':
      return 'ไม่พบรุ่น AI ที่เลือก ลองเปลี่ยนรุ่นในการตั้งค่า'
    case 'credit':
      return 'เครดิตในบัญชี Claude ไม่พอ เติมเครดิตใน Claude Console แล้วลองใหม่'
    case 'rate-limit':
      return 'เรียก AI ถี่เกินไป รอสักครู่แล้วลองใหม่'
    case 'overloaded':
      return 'ระบบ AI ไม่ว่างชั่วคราว ลองใหม่อีกครั้งในอีกสักครู่'
    case 'request':
      return 'AI ไม่รับคำขอนี้ ลองใหม่อีกครั้ง'
    case 'network':
      return 'เชื่อมต่อ AI ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่'
    case 'timeout':
      return 'AI ตอบช้าเกิน 1 นาที ลองใหม่อีกครั้ง'
    case 'cancelled':
      return 'ยกเลิกแล้ว'
    case 'bad-output':
      return 'AI ตอบกลับมาไม่ครบ ลองใหม่อีกครั้ง'
  }
}

export function errorFromResponse(status: number, body: unknown): AiErrorKind {
  const message = String((body as { error?: { message?: unknown } } | null)?.error?.message ?? '')
  if (status === 401) return 'bad-key'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'model'
  if (status === 429) return 'rate-limit'
  if (/credit balance/i.test(message)) return 'credit'
  if (status >= 500) return 'overloaded'
  return 'request'
}

// ---------- คำขอแบบ tool use ----------

export interface ToolSpec {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface AiRequest {
  system: string
  prompt: string
  tool: ToolSpec
  maxTokens: number
}

/** body ของ Messages API: บังคับให้ตอบผ่าน tool จะได้ JSON ตามโครงเสมอ */
export function messagesBody(model: string, request: AiRequest) {
  return {
    model,
    max_tokens: request.maxTokens,
    system: request.system,
    messages: [{ role: 'user', content: request.prompt }],
    tools: [request.tool],
    tool_choice: { type: 'tool', name: request.tool.name },
  }
}

/** ดึง input ของ tool จากคำตอบ ถ้าคำตอบถูกตัดหรือไม่มี tool ให้ถือว่าตอบไม่ครบ */
export function toolInput(json: unknown, name: string): Record<string, unknown> {
  const body = json as { content?: unknown; stop_reason?: unknown } | null
  if (!body || body.stop_reason === 'max_tokens' || !Array.isArray(body.content)) throw new AiError('bad-output')
  const block = body.content.find(
    (b): b is { input: unknown } =>
      typeof b === 'object' && b !== null && (b as { type?: unknown }).type === 'tool_use' && (b as { name?: unknown }).name === name,
  )
  if (!block || typeof block.input !== 'object' || block.input === null) throw new AiError('bad-output')
  return block.input as Record<string, unknown>
}

// ---------- เครื่องมือช่วยตรวจ ----------

const HORIZONS: Horizon[] = ['today', 'week', 'later']
const ENERGIES: Energy[] = ['deep', 'shallow']
const WEEKDAY_TH = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']
/** เวลาประมาณที่รับได้: 5 นาที ถึง 5 วันทำงาน */
export const ESTIMATE_MAX = 40 * 60
export const MAX_STEPS = 8

export function isDateKey(value: unknown): value is DateKey {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && toDateKey(fromDateKey(value)) === value
}

function cleanText(value: unknown, max = TITLE_MAX): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max).trim() : ''
}

/** ปัดเป็นทวีคูณ 5 นาที ในช่วงที่รับได้ ค่าที่ใช้ไม่ได้เป็น null */
export function cleanEstimate(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.min(ESTIMATE_MAX, Math.max(5, Math.round(value / 5) * 5))
}

const sameText = (a: string, b: string) => a.toLocaleLowerCase('th') === b.toLocaleLowerCase('th')

/** ขั้นที่ใช้ได้: เป็นข้อความ ไม่ว่าง ไม่ซ้ำกันและไม่ซ้ำขั้นเดิม */
export function cleanSteps(value: unknown, existing: string[] = [], max = MAX_STEPS): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    const text = cleanText(item).replace(/^\d+[.)]\s*/, '')
    if (!text || [...existing, ...out].some((s) => sameText(s, text))) continue
    out.push(text)
    if (out.length === max) break
  }
  return out
}

/** ส่งวันนี้ = วันนี้, ถึงวันอาทิตย์นี้ = สัปดาห์นี้, หลังจากนั้น = ไว้ก่อน */
export function horizonForDue(due: DateKey, today: DateKey): Horizon {
  if (due <= today) return 'today'
  return due <= addDays(startOfWeek(today), 6) ? 'week' : 'later'
}

/** ปฏิทินให้ AI แปลงคำอย่าง "ศุกร์หน้า" เป็นวันที่ได้ถูก */
export function calendarLines(today: DateKey, days = 14): string {
  const weekEnd = addDays(startOfWeek(today), 6)
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i)
    const tag = i === 0 ? ' (วันนี้)' : i === 1 ? ' (พรุ่งนี้)' : date <= weekEnd ? ' (สัปดาห์นี้)' : date <= addDays(weekEnd, 7) ? ' (สัปดาห์หน้า)' : ''
    return `${date} ${WEEKDAY_TH[weekdayOf(date)]}${tag}`
  }).join('\n')
}

function workdayNames(workdays: number[]): string {
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => workdays.includes(d)).map((d) => WEEKDAY_TH[d]).join(', ') || 'ไม่ได้ตั้ง'
}

// ---------- จดงานจากประโยค ----------

export interface CaptureContext {
  today: DateKey
  workdays: number[]
  projects: string[]
}

export interface CaptureSuggestion {
  title: string
  horizon: Horizon | null
  dueDate: DateKey | null
  estimateMinutes: number | null
  energy: Energy | null
  project: string | null
  steps: string[]
}

const CAPTURE_TOOL: ToolSpec = {
  name: 'capture_task',
  description: 'บันทึกงานหนึ่งชิ้นจากประโยคของผู้ใช้ลงแบบฟอร์ม',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'ชื่องานสั้น ๆ ภาษาไทย ขึ้นต้นด้วยสิ่งที่ต้องทำ ไม่มีวันที่หรือระยะเวลา' },
      horizon: { type: ['string', 'null'], enum: ['today', 'week', 'later', null], description: 'จะทำเมื่อไหร่' },
      due_date: { type: ['string', 'null'], description: 'กำหนดส่ง YYYY-MM-DD' },
      estimate_minutes: { type: ['integer', 'null'], description: 'เวลาทำงานทั้งหมดโดยประมาณ (นาที)' },
      energy: { type: ['string', 'null'], enum: ['deep', 'shallow', null] },
      project: { type: ['string', 'null'] },
      steps: { type: 'array', items: { type: 'string' }, description: 'ขั้นตอนที่ผู้ใช้พูดถึงเอง ตามลำดับ' },
    },
    required: ['title', 'horizon', 'due_date', 'estimate_minutes', 'energy', 'project', 'steps'],
  },
}

export function captureRequest(text: string, ctx: CaptureContext): AiRequest {
  return {
    system: [
      'You turn one Thai sentence describing a work task into fields for a personal task planner. Reply only by calling the tool.',
      'Write title and steps in Thai and keep the user\'s wording where possible. The title is short, starts with the action, and has no dates, durations or "waiting for" phrases.',
      'Fill a field only when the sentence states or clearly implies it; otherwise use null (or an empty list for steps).',
      'Resolve relative dates (พรุ่งนี้, ศุกร์นี้, สัปดาห์หน้า, สิ้นเดือน) with the calendar given. Never return a date before today.',
      'horizon: today = will do it today; week = this week; later = after this week.',
      'energy: deep = focused work such as writing, analysis, design; shallow = quick admin such as email, calls, forms.',
      'project: reuse an existing project name when it matches; only create a short new one when the sentence names a project or client.',
      'steps: only steps the sentence lists explicitly, in order.',
    ].join('\n'),
    prompt: [
      `วันนี้: ${ctx.today} (${WEEKDAY_TH[weekdayOf(ctx.today)]})`,
      `วันทำงาน: ${workdayNames(ctx.workdays)}`,
      `ปฏิทิน:\n${calendarLines(ctx.today)}`,
      `โปรเจกต์ที่มีอยู่: ${ctx.projects.length ? ctx.projects.join(', ') : 'ยังไม่มี'}`,
      `ประโยคของผู้ใช้:\n${text.trim()}`,
    ].join('\n\n'),
    tool: CAPTURE_TOOL,
    maxTokens: 1000,
  }
}

export function parseCapture(input: Record<string, unknown>, ctx: CaptureContext): CaptureSuggestion {
  const title = cleanText(input.title)
  if (!title) throw new AiError('bad-output')
  const dueDate = isDateKey(input.due_date) && input.due_date >= ctx.today ? input.due_date : null
  const horizon = HORIZONS.includes(input.horizon as Horizon)
    ? (input.horizon as Horizon)
    : dueDate
      ? horizonForDue(dueDate, ctx.today)
      : null
  const project = cleanText(input.project, 80)
  return {
    title,
    horizon,
    dueDate,
    estimateMinutes: cleanEstimate(input.estimate_minutes),
    energy: ENERGIES.includes(input.energy as Energy) ? (input.energy as Energy) : null,
    // สะกดตามโปรเจกต์ที่มีอยู่ ถ้าชื่อตรงกัน
    project: project ? (ctx.projects.find((p) => sameText(p, project)) ?? project) : null,
    steps: cleanSteps(input.steps),
  }
}

/** เติมฟอร์มจากผลของ AI: แทนที่ชื่องาน, ช่องที่ AI ไม่ระบุคงค่าเดิม, ขั้นเพิ่มต่อท้าย */
export function applyCapture(draft: LoopDraft, s: CaptureSuggestion): LoopDraft {
  const existing = draft.steps.map((x) => x.title)
  return {
    ...draft,
    title: s.title,
    horizon: s.horizon ?? draft.horizon,
    dueDate: s.dueDate ?? draft.dueDate,
    estimateMinutes: s.estimateMinutes ?? draft.estimateMinutes,
    energy: s.energy ?? draft.energy,
    project: s.project ?? draft.project,
    steps: [...draft.steps, ...cleanSteps(s.steps, existing).map(newStep)],
  }
}

// ---------- แตกงานเป็นขั้น ----------

export interface BreakdownInput {
  title: string
  project: string | null
  estimateMinutes: number | null
  steps: string[]
}

const BREAKDOWN_TOOL: ToolSpec = {
  name: 'suggest_steps',
  description: 'เสนอขั้นตอนที่ลงมือทำได้ของงานนี้',
  input_schema: {
    type: 'object',
    properties: {
      steps: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: MAX_STEPS },
    },
    required: ['steps'],
  },
}

export function breakdownRequest(input: BreakdownInput): AiRequest {
  return {
    system: [
      'You break a work task into concrete next actions for a Thai office worker. Reply only by calling the tool.',
      `Give 2–${MAX_STEPS} steps in the order they should be done. Each step is a short Thai phrase that starts with a verb and is specific enough to start right away. No numbering.`,
      'If the task already has steps, do not repeat them; suggest only what is still missing, continuing after them.',
      'Do not invent facts such as names, numbers or dates that are not in the task.',
    ].join('\n'),
    prompt: [
      `งาน: ${input.title.trim()}`,
      input.project ? `โปรเจกต์: ${input.project}` : null,
      input.estimateMinutes ? `เวลาประมาณทั้งงาน: ${input.estimateMinutes} นาที` : null,
      input.steps.length ? `ขั้นที่มีอยู่แล้ว:\n${input.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : 'ยังไม่มีขั้น',
    ]
      .filter(Boolean)
      .join('\n'),
    tool: BREAKDOWN_TOOL,
    maxTokens: 800,
  }
}

export function parseBreakdown(input: Record<string, unknown>, existing: string[]): string[] {
  const steps = cleanSteps(input.steps, existing)
  if (!steps.length) throw new AiError('bad-output')
  return steps
}

// ---------- แผนเช้า ----------

/** ส่งงานให้ AI ไม่เกินเท่านี้ เพื่อคุมขนาดคำขอ */
export const PLAN_MAX_LOOPS = 40
/** งานที่ไม่ได้ประเมินเวลา ให้ AI คิดเป็นเท่านี้ */
const UNESTIMATED_MINUTES = 30

export interface PlanContext {
  today: DateKey
  settings: PlannerSettings
  load: DayLoad
  /** วันที่งานที่ถูกเลื่อนจะไปอยู่ */
  postponeDate: DateKey
}

export interface PlanRequest {
  request: AiRequest
  /** รหัสสั้นที่ส่งให้ AI → งานจริง */
  refs: Record<string, Loop>
}

/** งานที่ให้ AI พิจารณา: เปิดอยู่และไม่ได้รอคนอื่น เรียงงานวันนี้และงานเร่งก่อน */
export function planPool(loops: Loop[]): Loop[] {
  const key = (d: DateKey | null) => d ?? '9999-12-31'
  return loops
    .filter((l) => !isClosed(l) && l.status !== 'waiting')
    .sort(
      (a, b) =>
        Number(b.horizon === 'today') - Number(a.horizon === 'today') ||
        key(a.dueDate).localeCompare(key(b.dueDate)) ||
        key(a.plannedDate).localeCompare(key(b.plannedDate)) ||
        compareOpen(a, b),
    )
    .slice(0, PLAN_MAX_LOOPS)
}

function whereOf(loop: Loop): string {
  if (loop.horizon === 'today') return 'today'
  if (loop.plannedDate) return `planned ${loop.plannedDate}`
  if (loop.horizon === 'week') return 'this-week tray'
  return loop.horizon === 'month' ? 'this-month list' : 'later'
}

function flagsOf(loop: Loop, ctx: PlanContext): string[] {
  const f = loopFlags(loop, ctx.today, ctx.settings)
  const out: string[] = []
  if (f.overdueDays !== null) out.push(`overdue ${f.overdueDays} days`)
  else if (loop.dueDate === ctx.today) out.push('due today')
  if (f.mustStartSince) out.push('must start now to meet due date')
  if (f.stalledDays !== null) out.push(`no progress for ${f.stalledDays} workdays`)
  if (loop.status === 'blocked') out.push('blocked')
  return out
}

const PLAN_TOOL: ToolSpec = {
  name: 'plan_today',
  description: 'แผนงานของวันนี้',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'ภาพรวมของวันนี้ 1–2 ประโยค' },
      today: {
        type: 'array',
        description: 'งานที่ควรทำวันนี้ เรียงตามลำดับที่ควรลงมือ',
        items: {
          type: 'object',
          properties: { ref: { type: 'string' }, reason: { type: 'string' } },
          required: ['ref', 'reason'],
        },
      },
      postpone: {
        type: 'array',
        description: 'งานที่อยู่ในวันนี้แต่ควรเลื่อนไปวันทำงานถัดไป',
        items: {
          type: 'object',
          properties: { ref: { type: 'string' }, reason: { type: 'string' } },
          required: ['ref', 'reason'],
        },
      },
    },
    required: ['summary', 'today', 'postpone'],
  },
}

export function planRequest(loops: Loop[], ctx: PlanContext): PlanRequest {
  const pool = planPool(loops)
  const refs: Record<string, Loop> = {}
  const lines = pool.map((loop, i) => {
    const ref = `L${i + 1}`
    refs[ref] = loop
    const { done, total } = progress(loop)
    return JSON.stringify({
      ref,
      title: loop.title,
      project: loop.project,
      where: whereOf(loop),
      status: loop.status,
      due: loop.dueDate,
      remaining_minutes: remainingMinutes(loop),
      energy: loop.energy,
      steps: total ? `${done}/${total} done` : null,
      next_step: nextStep(loop)?.title ?? null,
      postponed_times: loop.rolloverCount,
      flags: flagsOf(loop, ctx),
    })
  })
  return {
    refs,
    request: {
      system: [
        'You are a pragmatic planning assistant for a Thai knowledge worker. Build today\'s plan from the open tasks. Reply only by calling the tool.',
        `1. Tasks in "today" should fit in free_minutes in total (use remaining_minutes; a task without it counts as ${UNESTIMATED_MINUTES}).`,
        '2. Priority: overdue, due today, must start now, due soon, then tasks already in today that are in progress.',
        '3. "postpone" may only contain tasks whose where is "today" and that do not fit. Never postpone overdue or due-today tasks.',
        '4. Order "today" in the sequence to work: deep, focused work earlier in the day; quick tasks between.',
        '5. Each reason is one short, concrete Thai sentence (mention the due date, flag or size). The summary is 1–2 Thai sentences.',
        '6. Use refs exactly as given. Leave out tasks that should stay where they are.',
      ].join('\n'),
      prompt: [
        `วันนี้: ${ctx.today} (${WEEKDAY_TH[weekdayOf(ctx.today)]})`,
        `free_minutes วันนี้ (หักประชุม ปฏิทิน และเวลาเผื่อแล้ว): ${ctx.load.freeMinutes}`,
        `next_workday สำหรับงานที่เลื่อน: ${ctx.postponeDate}`,
        `งานที่เปิดอยู่ (${pool.length} งาน):`,
        lines.join('\n') || '(ไม่มี)',
      ].join('\n'),
      tool: PLAN_TOOL,
      maxTokens: 2000,
    },
  }
}

export interface PlanItem {
  loop: Loop
  reason: string
  /** ยังไม่อยู่ในวันนี้ ต้องดึงเข้า */
  pull: boolean
}

export interface AiPlan {
  summary: string
  order: PlanItem[]
  postpone: { loop: Loop; reason: string }[]
  /** คำแนะนำที่ถูกกรองทิ้งเพราะผิดกติกา */
  ignored: number
}

function entries(value: unknown): { ref: string; reason: string }[] | null {
  if (!Array.isArray(value)) return null
  return value
    .filter((e): e is { ref: unknown; reason?: unknown } => typeof e === 'object' && e !== null)
    .map((e) => ({ ref: String(e.ref ?? '').trim(), reason: cleanText(e.reason, 200) }))
}

export function parsePlan(input: Record<string, unknown>, refs: Record<string, Loop>, today: DateKey): AiPlan {
  const todayList = entries(input.today)
  const postponeList = entries(input.postpone)
  if (!todayList || !postponeList) throw new AiError('bad-output')
  const seen = new Set<string>()
  let ignored = 0
  const order: PlanItem[] = []
  for (const { ref, reason } of todayList) {
    const loop = refs[ref]
    if (!loop || seen.has(loop.id)) {
      ignored++
      continue
    }
    seen.add(loop.id)
    order.push({ loop, reason, pull: loop.horizon !== 'today' })
  }
  const postpone: AiPlan['postpone'] = []
  for (const { ref, reason } of postponeList) {
    const loop = refs[ref]
    // เลื่อนได้เฉพาะงานในวันนี้ที่ยังไม่ถึงกำหนด และไม่ขัดกับรายการที่ให้ทำวันนี้
    const urgent = !!loop?.dueDate && loop.dueDate <= today
    if (!loop || seen.has(loop.id) || loop.horizon !== 'today' || urgent) {
      ignored++
      continue
    }
    seen.add(loop.id)
    postpone.push({ loop, reason })
  }
  return { summary: cleanText(input.summary, 400), order, postpone, ignored }
}

/** id ของการย้ายทั้งหมดในแผน ใช้เป็นค่าเริ่มต้นของรายการที่เลือก */
export function planChangeIds(plan: AiPlan): string[] {
  return [...plan.order.filter((i) => i.pull).map((i) => i.loop.id), ...plan.postpone.map((p) => p.loop.id)]
}

/**
 * ใช้แผนกับข้อมูลล่าสุด เฉพาะการย้ายที่ผู้ใช้เลือก
 * งานที่ถูกปิดหรือถูกย้ายไปแล้วระหว่างรอ AI จะข้ามไป
 */
export function applyAiPlan(
  current: Loop[],
  plan: AiPlan,
  selected: ReadonlySet<string>,
  now: Date,
  postponeDate: DateKey,
): { changed: Loop[]; previous: Loop[] } {
  const byId = new Map(current.map((l) => [l.id, l]))
  const changed: Loop[] = []
  const previous: Loop[] = []
  const take = (id: string, move: (l: Loop) => Loop, stillValid: (l: Loop) => boolean) => {
    const loop = byId.get(id)
    if (!selected.has(id) || !loop || isClosed(loop) || !stillValid(loop)) return
    previous.push(loop)
    changed.push(move(loop))
  }
  for (const item of plan.order) {
    if (item.pull) take(item.loop.id, (l) => setHorizon(l, 'today', now), (l) => l.horizon !== 'today')
  }
  for (const p of plan.postpone) {
    take(p.loop.id, (l) => scheduleOn(l, postponeDate, now), (l) => l.horizon === 'today')
  }
  return { changed, previous }
}
