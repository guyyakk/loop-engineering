import { validateClientId } from './calendar'
import { DEFAULT_SETTINGS, type Particle, type PlannerSettings } from './capacity'
import { dateKeyOf, daysBetween, toDateKey, type DateKey } from './dates'
import type { DayPlan } from './day'
import { isClosed, type Energy, type Horizon, type Loop, type LoopStatus, type Step } from './loop'

// ไฟล์สำรอง: JSON ที่อ่านได้ ตรวจทั้งไฟล์ก่อนนำเข้า ผิดตรงไหนก็ไม่แตะข้อมูลเดิม

/** 2 = มีช่วง "เดือนนี้" และโหมดง่าย/ละเอียด (ยังอ่านไฟล์รุ่น 1 ได้) */
export const BACKUP_FORMAT = 2
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024
/** สำรองล่าสุดเกินกี่วันถึงเตือน */
export const BACKUP_STALE_DAYS = 7
/** ยังไม่เคยสำรอง จะเตือนเมื่อมีงานอย่างน้อยเท่านี้ */
export const BACKUP_MIN_LOOPS = 5

export interface Backup {
  app: 'openloops'
  format: number
  exportedAt: string
  loops: Loop[]
  days: DayPlan[]
  settings: PlannerSettings
}

export interface BackupSummary {
  exportedAt: string
  loops: number
  open: number
  closed: number
  days: number
}

export type ParseResult = { ok: true; backup: Backup; summary: BackupSummary } | { ok: false; error: string }

export function makeBackup(loops: Loop[], days: DayPlan[], settings: PlannerSettings, now: Date): Backup {
  return { app: 'openloops', format: BACKUP_FORMAT, exportedAt: now.toISOString(), loops, days, settings }
}

export function backupFileName(now: Date): string {
  return `openloops-backup-${toDateKey(now)}.json`
}

export function summarize(backup: Backup): BackupSummary {
  const closed = backup.loops.filter(isClosed).length
  return {
    exportedAt: backup.exportedAt,
    loops: backup.loops.length,
    open: backup.loops.length - closed,
    closed,
    days: backup.days.length,
  }
}

// ---------- ตรวจและเติมค่าเริ่มต้น ----------

const STATUSES: LoopStatus[] = ['active', 'waiting', 'blocked', 'done', 'dropped']
const HORIZONS: Horizon[] = ['today', 'week', 'month', 'later']
const ENERGIES: Energy[] = ['deep', 'shallow']
const PARTICLES: Particle[] = ['', 'ครับ', 'ค่ะ']
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const isText = (v: unknown): v is string => typeof v === 'string'
const isTime = (v: unknown): v is string => isText(v) && !Number.isNaN(Date.parse(v))
const orNull = <T>(v: unknown, ok: (x: unknown) => x is T): T | null => (ok(v) ? v : null)
/** เวลาเก็บเป็น ISO แบบ UTC เสมอ การเทียบ "แก้ล่าสุด" ด้วยสตริงจึงถูกต้อง แม้ไฟล์ถูกแก้ด้วยมือ */
const toIso = (v: string) => new Date(v).toISOString()
const timeOrNull = (v: unknown) => (isTime(v) ? toIso(v) : null)
const isDateKey = (v: unknown): v is string => isText(v) && DATE_KEY.test(v)
const isMinutes = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

class BackupError extends Error {}

function parseStep(raw: unknown): Step {
  if (!isObject(raw) || !isText(raw.id) || !isText(raw.title)) throw new BackupError('ขั้นตอน')
  return { id: raw.id, title: raw.title, doneAt: timeOrNull(raw.doneAt) }
}

/** ตรวจงานหนึ่งตัว ฟิลด์บังคับต้องครบ ฟิลด์ไม่บังคับที่ไม่มี (เช่น ไฟล์จากรุ่นเก่า) ใช้ค่าเริ่มต้น */
function parseLoop(raw: unknown): Loop {
  if (!isObject(raw)) throw new BackupError('ไม่ใช่ข้อมูลงาน')
  const { id, title, status, horizon, createdAt, updatedAt } = raw
  if (!isText(id) || !id) throw new BackupError('ไม่มี id')
  if (!isText(title) || !title.trim()) throw new BackupError('ไม่มีชื่องาน')
  if (!STATUSES.includes(status as LoopStatus)) throw new BackupError('สถานะไม่ถูกต้อง')
  if (!HORIZONS.includes(horizon as Horizon)) throw new BackupError('ช่วงเวลาไม่ถูกต้อง')
  if (!isTime(createdAt) || !isTime(updatedAt)) throw new BackupError('เวลาไม่ถูกต้อง')
  if (raw.steps !== undefined && !Array.isArray(raw.steps)) throw new BackupError('ขั้นตอน')
  const loop: Loop = {
    id,
    title,
    project: orNull(raw.project, isText),
    steps: ((raw.steps as unknown[] | undefined) ?? []).map(parseStep),
    status: status as LoopStatus,
    horizon: horizon as Horizon,
    energy: ENERGIES.includes(raw.energy as Energy) ? (raw.energy as Energy) : null,
    dueDate: orNull(raw.dueDate, isDateKey),
    estimateMinutes: orNull(raw.estimateMinutes, isMinutes),
    waitingOn: orNull(raw.waitingOn, isText),
    followUpDate: orNull(raw.followUpDate, isDateKey),
    createdAt: toIso(createdAt),
    updatedAt: toIso(updatedAt),
    lastProgressAt: isTime(raw.lastProgressAt) ? toIso(raw.lastProgressAt) : toIso(updatedAt),
    closedAt: timeOrNull(raw.closedAt),
    rolloverCount: Number.isInteger(raw.rolloverCount) && (raw.rolloverCount as number) >= 0 ? (raw.rolloverCount as number) : 0,
    plannedDate: orNull(raw.plannedDate, isDateKey),
    carriedOn: orNull(raw.carriedOn, isDateKey),
  }
  if (isDateKey(raw.carriedFrom)) loop.carriedFrom = raw.carriedFrom
  // ลูปที่รอคนอื่นต้องมีคนที่รอ ไม่เช่นนั้นหน้าจอจะแสดงผิด
  if (loop.status === 'waiting' && !loop.waitingOn) throw new BackupError('รอคนอื่นแต่ไม่มีชื่อคน')
  return loop
}

function parseDay(raw: unknown): DayPlan {
  if (!isObject(raw) || !isDateKey(raw.date)) throw new BackupError('วันที่ไม่ถูกต้อง')
  const day: DayPlan = {
    date: raw.date,
    meetingMinutes: typeof raw.meetingMinutes === 'number' && raw.meetingMinutes >= 0 ? raw.meetingMinutes : 0,
  }
  if (isObject(raw.sent)) {
    day.sent = {}
    if (isTime(raw.sent.brief)) day.sent.brief = raw.sent.brief
    if (isTime(raw.sent.shutdown)) day.sent.shutdown = raw.sent.shutdown
  }
  if (isTime(raw.shutdownAt)) day.shutdownAt = raw.shutdownAt
  if (isText(raw.note)) day.note = raw.note
  if (isTime(raw.reviewAt)) day.reviewAt = raw.reviewAt
  if (typeof raw.calendarMinutes === 'number' && raw.calendarMinutes >= 0) day.calendarMinutes = raw.calendarMinutes
  return day
}

function parseSettings(raw: unknown): PlannerSettings {
  const s = isObject(raw) ? raw : {}
  const d = DEFAULT_SETTINGS
  const workdays = Array.isArray(s.workdays) && s.workdays.every((x) => Number.isInteger(x) && x >= 0 && x <= 6) ? (s.workdays as number[]) : d.workdays
  return {
    workMinutes: isMinutes(s.workMinutes) ? s.workMinutes : d.workMinutes,
    bufferMinutes: typeof s.bufferMinutes === 'number' && s.bufferMinutes >= 0 ? s.bufferMinutes : d.bufferMinutes,
    workdays: workdays.length ? workdays : d.workdays,
    startMinutes: typeof s.startMinutes === 'number' && s.startMinutes >= 0 && s.startMinutes < 1440 ? s.startMinutes : d.startMinutes,
    notify: typeof s.notify === 'boolean' ? s.notify : d.notify,
    particle: PARTICLES.includes(s.particle as Particle) ? (s.particle as Particle) : d.particle,
    lastBackupAt: orNull(s.lastBackupAt, isTime),
    googleClientId: isText(s.googleClientId) && !validateClientId(s.googleClientId) ? s.googleClientId.trim() : null,
    calendarEnabled: typeof s.calendarEnabled === 'boolean' ? s.calendarEnabled : d.calendarEnabled,
    calendarSyncedAt: orNull(s.calendarSyncedAt, isTime),
    detailed: typeof s.detailed === 'boolean' ? s.detailed : d.detailed,
  }
}

export function parseBackup(text: string): ParseResult {
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, error: 'ไฟล์ใหญ่เกิน 10 MB ไม่น่าใช่ไฟล์สำรองของ OpenLoops' }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'อ่านไฟล์ไม่ได้ ไฟล์นี้ไม่ใช่ JSON หรือเสียระหว่างทาง' }
  }
  if (!isObject(raw) || raw.app !== 'openloops') return { ok: false, error: 'ไฟล์นี้ไม่ใช่ไฟล์สำรองของ OpenLoops' }
  if (typeof raw.format !== 'number' || raw.format > BACKUP_FORMAT) {
    return { ok: false, error: 'ไฟล์นี้มาจาก OpenLoops รุ่นที่ใหม่กว่า อัปเดตแอปก่อนแล้วลองอีกครั้ง' }
  }
  if (!Array.isArray(raw.loops) || !Array.isArray(raw.days ?? [])) return { ok: false, error: 'ไฟล์ไม่มีรายการงาน' }

  const loops: Loop[] = []
  for (const [i, item] of raw.loops.entries()) {
    try {
      loops.push(parseLoop(item))
    } catch (e) {
      if (!(e instanceof BackupError)) throw e
      return { ok: false, error: `งานลำดับที่ ${i + 1} ในไฟล์ข้อมูลไม่ครบ (${e.message}) จึงยังไม่นำเข้าอะไรเลย` }
    }
  }
  if (new Set(loops.map((l) => l.id)).size !== loops.length) {
    return { ok: false, error: 'ในไฟล์มีงานที่ id ซ้ำกัน จึงยังไม่นำเข้าอะไรเลย' }
  }

  const days: DayPlan[] = []
  for (const [i, item] of ((raw.days as unknown[] | undefined) ?? []).entries()) {
    try {
      days.push(parseDay(item))
    } catch (e) {
      if (!(e instanceof BackupError)) throw e
      return { ok: false, error: `ข้อมูลรายวันลำดับที่ ${i + 1} ไม่ถูกต้อง (${e.message}) จึงยังไม่นำเข้าอะไรเลย` }
    }
  }

  const backup: Backup = {
    app: 'openloops',
    format: raw.format,
    exportedAt: isTime(raw.exportedAt) ? raw.exportedAt : new Date(0).toISOString(),
    loops,
    days,
    settings: parseSettings(raw.settings),
  }
  return { ok: true, backup, summary: summarize(backup) }
}

// ---------- รวมกับข้อมูลเดิม ----------

export interface MergePlan {
  /** งานที่ต้องบันทึก (ใหม่ + ที่ในไฟล์แก้ล่าสุดกว่า) */
  loops: Loop[]
  days: DayPlan[]
  added: number
  updated: number
  kept: number
}

/** งานใหม่เพิ่มเข้า, งานที่มีอยู่ใช้ฉบับที่แก้ล่าสุด, ข้อมูลรายวันเติมเฉพาะวันที่ยังไม่มี */
export function mergeBackup(current: { loops: Loop[]; days: DayPlan[] }, incoming: Backup): MergePlan {
  const byId = new Map(current.loops.map((l) => [l.id, l]))
  const loops: Loop[] = []
  let added = 0
  let updated = 0
  let kept = 0
  for (const loop of incoming.loops) {
    const mine = byId.get(loop.id)
    if (!mine) {
      loops.push(loop)
      added++
    } else if (loop.updatedAt > mine.updatedAt) {
      loops.push(loop)
      updated++
    } else {
      kept++
    }
  }
  const dates = new Set(current.days.map((d) => d.date))
  return { loops, days: incoming.days.filter((d) => !dates.has(d.date)), added, updated, kept }
}

// ---------- เตือนให้สำรอง ----------

/** อายุของไฟล์สำรองล่าสุดเป็นวัน หรือ null ถ้ายังไม่เคยสำรอง */
export function backupAgeDays(lastBackupAt: string | null, today: DateKey): number | null {
  return lastBackupAt ? daysBetween(dateKeyOf(lastBackupAt), today) : null
}

export function backupReminder(
  lastBackupAt: string | null,
  loopCount: number,
  today: DateKey,
  dismissedOn: string | null,
): boolean {
  if (dismissedOn === today) return false
  const age = backupAgeDays(lastBackupAt, today)
  return age === null ? loopCount >= BACKUP_MIN_LOOPS : age >= BACKUP_STALE_DAYS
}
