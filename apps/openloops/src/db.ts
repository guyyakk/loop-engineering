import Dexie, { type EntityTable } from 'dexie'
import { DEFAULT_AI_CONFIG, type AiConfig } from './domain/ai'
import { DEFAULT_SETTINGS, type DayBusy, type PlannerSettings } from './domain/capacity'
import { toDateKey, type DateKey } from './domain/dates'
import type { DayPatch, DayPlan } from './domain/day'
import { startDay, type Loop } from './domain/loop'
import type { NotifyKind } from './domain/nudges'

export type { DayPatch, DayPlan }

// ข้อมูลทั้งหมดอยู่ใน IndexedDB ของเครื่องนี้ ไม่มี server

interface SettingsRow extends PlannerSettings {
  key: 'planner'
}

/** ค่าที่อยู่เฉพาะเครื่องนี้ (เช่น API key) ไม่อยู่ในไฟล์สำรองและไม่ถูกแทนที่ตอนนำเข้า */
interface LocalRow extends AiConfig {
  key: 'ai'
}

export type OpenLoopsDB = Dexie & {
  loops: EntityTable<Loop, 'id'>
  days: EntityTable<DayPlan, 'date'>
  settings: EntityTable<SettingsRow, 'key'>
  local: EntityTable<LocalRow, 'key'>
}

export function openDb(name = 'openloops'): OpenLoopsDB {
  const db = new Dexie(name) as OpenLoopsDB
  db.version(1).stores({ loops: 'id, status, horizon, dueDate, updatedAt' })
  db.version(2)
    .stores({ loops: 'id, status, horizon, dueDate, updatedAt, plannedDate', days: 'date', settings: 'key' })
    .upgrade((tx) => {
      // ลูปจาก v1 ที่อยู่ในวันนี้ ให้นับเป็นงานของวันที่อัปเกรด ไม่ใช่งานยกมา
      const today = toDateKey(new Date())
      return tx
        .table('loops')
        .toCollection()
        .modify((loop: Loop) => {
          const open = loop.status !== 'done' && loop.status !== 'dropped'
          loop.plannedDate = loop.horizon === 'today' && open ? today : null
          loop.carriedOn = null
        })
    })
  db.version(3).stores({ local: 'key' })
  return db
}

export const db = openDb()

export function saveLoop(loop: Loop, target: OpenLoopsDB = db): Promise<string> {
  return target.loops.put(loop)
}

export async function saveLoops(loops: Loop[], target: OpenLoopsDB = db): Promise<void> {
  await target.loops.bulkPut(loops)
}

export function allLoops(target: OpenLoopsDB = db): Promise<Loop[]> {
  return target.loops.toArray()
}

export async function getSettings(target: OpenLoopsDB = db): Promise<PlannerSettings> {
  const row = await target.settings.get('planner')
  if (!row) return DEFAULT_SETTINGS
  // แถวจาก spec ก่อน ๆ อาจยังไม่มีค่าที่เพิ่มทีหลัง ให้ใช้ค่าเริ่มต้นแทน
  const { key: _key, ...stored } = row
  return { ...DEFAULT_SETTINGS, ...stored }
}

export async function saveSettings(settings: PlannerSettings, target: OpenLoopsDB = db): Promise<void> {
  await target.settings.put({ key: 'planner', ...settings })
}

export async function getAiConfig(target: OpenLoopsDB = db): Promise<AiConfig> {
  const row = await target.local.get('ai')
  return { apiKey: row?.apiKey || null, model: row?.model || DEFAULT_AI_CONFIG.model }
}

export async function saveAiConfig(config: AiConfig, target: OpenLoopsDB = db): Promise<void> {
  await target.local.put({ key: 'ai', apiKey: config.apiKey?.trim() || null, model: config.model })
}

export async function getMeetingMinutes(date: DateKey, target: OpenLoopsDB = db): Promise<number> {
  return (await target.days.get(date))?.meetingMinutes ?? 0
}

/** เวลาประชุมของทุกวันในช่วง `from`–`to` (รวมหัวท้าย) วันที่ไม่ได้ตั้งไว้จะไม่มีในผลลัพธ์ */
export async function getMeetings(from: DateKey, to: DateKey, target: OpenLoopsDB = db): Promise<Record<DateKey, number>> {
  const rows = await target.days.where('date').between(from, to, true, true).toArray()
  return Object.fromEntries(rows.map((r) => [r.date, r.meetingMinutes]))
}

export function saveMeetingMinutes(date: DateKey, meetingMinutes: number, target: OpenLoopsDB = db): Promise<void> {
  // เก็บข้อมูลอื่นของวันนั้นไว้ด้วย (เช่น การแจ้งเตือนที่ส่งแล้ว)
  return target.transaction('rw', target.days, async () => {
    const row = await target.days.get(date)
    await target.days.put({ ...row, date, meetingMinutes })
  })
}

const busyOf = (row: DayPlan | undefined): DayBusy => ({
  manual: row?.meetingMinutes ?? 0,
  calendar: row?.calendarMinutes ?? null,
})

export async function getBusy(date: DateKey, target: OpenLoopsDB = db): Promise<DayBusy> {
  return busyOf(await target.days.get(date))
}

/** เวลาไม่ว่างของทุกวันในช่วง วันที่ไม่มีแถวจะไม่มีในผลลัพธ์ */
export async function getBusyRange(from: DateKey, to: DateKey, target: OpenLoopsDB = db): Promise<Record<DateKey, DayBusy>> {
  const rows = await target.days.where('date').between(from, to, true, true).toArray()
  return Object.fromEntries(rows.map((r) => [r.date, busyOf(r)]))
}

/** บันทึกนาทีจากปฏิทินของหลายวัน โดยไม่แตะข้อมูลอื่นของวันนั้น */
export function saveCalendarBusy(byDay: Record<DateKey, number>, target: OpenLoopsDB = db): Promise<void> {
  return target.transaction('rw', target.days, async () => {
    for (const [date, calendarMinutes] of Object.entries(byDay)) {
      const row = await target.days.get(date)
      await target.days.put({ meetingMinutes: 0, ...row, date, calendarMinutes })
    }
  })
}

/** ตัดการเชื่อมต่อ: ลบนาทีจากปฏิทินทุกวัน ธุระที่กดเองยังอยู่ */
export function clearCalendarBusy(target: OpenLoopsDB = db): Promise<number> {
  return target.days.toCollection().modify((row) => {
    delete row.calendarMinutes
  })
}

export function getDays(from: DateKey, to: DateKey, target: OpenLoopsDB = db): Promise<DayPlan[]> {
  return target.days.where('date').between(from, to, true, true).toArray()
}

/**
 * บันทึกผลของพิธีปิดวัน/ทบทวนสัปดาห์ในธุรกรรมเดียว: ลูปที่เปลี่ยน + ข้อมูลของวัน
 * คืนแถวของวันก่อนแก้ ไว้ใช้เลิกทำ
 */
export function commitRitual(
  date: DateKey,
  loops: Loop[],
  patch: DayPatch,
  target: OpenLoopsDB = db,
): Promise<DayPlan | undefined> {
  return target.transaction('rw', target.loops, target.days, async () => {
    const before = await target.days.get(date)
    await target.loops.bulkPut(loops)
    await target.days.put({ date, meetingMinutes: 0, ...before, ...patch })
    return before
  })
}

/** เลิกทำพิธี: คืนลูปและข้อมูลของวันกลับเป็นแบบเดิม */
export function undoRitual(date: DateKey, loops: Loop[], dayBefore: DayPlan | undefined, target: OpenLoopsDB = db): Promise<void> {
  return target.transaction('rw', target.loops, target.days, async () => {
    await target.loops.bulkPut(loops)
    if (dayBefore) await target.days.put(dayBefore)
    else await target.days.delete(date)
  })
}

export async function getSent(date: DateKey, target: OpenLoopsDB = db): Promise<Partial<Record<NotifyKind, string>>> {
  return (await target.days.get(date))?.sent ?? {}
}

/** จองสิทธิ์ส่งแจ้งเตือนชนิดนี้ของวันนี้ คืน true แค่ครั้งแรก แม้หลายหน้าต่างเรียกพร้อมกัน */
export function claimNotification(date: DateKey, kind: NotifyKind, target: OpenLoopsDB = db): Promise<boolean> {
  return target.transaction('rw', target.days, async () => {
    const row = await target.days.get(date)
    if (row?.sent?.[kind]) return false
    await target.days.put({ date, meetingMinutes: 0, ...row, sent: { ...row?.sent, [kind]: new Date().toISOString() } })
    return true
  })
}

/** ยกงานข้ามวันในธุรกรรมเดียว อ่านข้อมูลล่าสุดเสมอ จึงรันซ้ำได้โดยไม่นับซ้ำ */
export function rollOverDay(today: DateKey, workdays: number[], target: OpenLoopsDB = db): Promise<number> {
  return target.transaction('rw', target.loops, async () => {
    const changed = startDay(await target.loops.toArray(), today, workdays)
    await target.loops.bulkPut(changed)
    return changed.length
  })
}

/** ข้อมูลทั้งหมดของแอป ใช้ทั้งส่งออกไฟล์สำรองและเลิกทำการนำเข้า */
export interface Snapshot {
  loops: Loop[]
  days: DayPlan[]
  settings: PlannerSettings
}

export function readAll(target: OpenLoopsDB = db): Promise<Snapshot> {
  return target.transaction('r', target.loops, target.days, target.settings, async () => ({
    loops: await target.loops.toArray(),
    days: await target.days.toArray(),
    settings: await getSettings(target),
  }))
}

/** แทนที่ข้อมูลทั้งหมดในธุรกรรมเดียว ถ้าพังกลางทางข้อมูลเดิมยังอยู่ครบ */
export function replaceAll(data: Snapshot, target: OpenLoopsDB = db): Promise<void> {
  return target.transaction('rw', target.loops, target.days, target.settings, async () => {
    await Promise.all([target.loops.clear(), target.days.clear(), target.settings.clear()])
    await target.loops.bulkPut(data.loops)
    await target.days.bulkPut(data.days)
    await target.settings.put({ key: 'planner', ...data.settings })
  })
}

/** เพิ่ม/อัปเดตงานและข้อมูลรายวันที่ผ่านการรวมแล้ว */
export function putMerged(loops: Loop[], days: DayPlan[], target: OpenLoopsDB = db): Promise<void> {
  return target.transaction('rw', target.loops, target.days, async () => {
    await target.loops.bulkPut(loops)
    await target.days.bulkPut(days)
  })
}

/** ขอให้ browser ไม่ลบข้อมูลทิ้งเองเมื่อพื้นที่เหลือน้อย */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    return (await navigator.storage.persisted()) || (await navigator.storage.persist())
  } catch {
    return false
  }
}
