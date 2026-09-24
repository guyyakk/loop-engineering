import Dexie, { type EntityTable } from 'dexie'
import { DEFAULT_SETTINGS, DEFAULT_WORKDAYS, type PlannerSettings } from './domain/capacity'
import { toDateKey, type DateKey } from './domain/dates'
import { startDay, type Loop } from './domain/loop'

// ข้อมูลทั้งหมดอยู่ใน IndexedDB ของเครื่องนี้ ไม่มี server

/** ข้อมูลของแต่ละวัน ตอนนี้มีแค่เวลาประชุม/ธุระ */
export interface DayPlan {
  date: DateKey
  meetingMinutes: number
}

interface SettingsRow extends PlannerSettings {
  key: 'planner'
}

export type OpenLoopsDB = Dexie & {
  loops: EntityTable<Loop, 'id'>
  days: EntityTable<DayPlan, 'date'>
  settings: EntityTable<SettingsRow, 'key'>
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
  // แถวจาก spec 2 ยังไม่มีวันทำงาน
  return { workMinutes: row.workMinutes, bufferMinutes: row.bufferMinutes, workdays: row.workdays ?? DEFAULT_WORKDAYS }
}

export async function saveSettings(settings: PlannerSettings, target: OpenLoopsDB = db): Promise<void> {
  await target.settings.put({ key: 'planner', ...settings })
}

export async function getMeetingMinutes(date: DateKey, target: OpenLoopsDB = db): Promise<number> {
  return (await target.days.get(date))?.meetingMinutes ?? 0
}

/** เวลาประชุมของทุกวันในช่วง `from`–`to` (รวมหัวท้าย) วันที่ไม่ได้ตั้งไว้จะไม่มีในผลลัพธ์ */
export async function getMeetings(from: DateKey, to: DateKey, target: OpenLoopsDB = db): Promise<Record<DateKey, number>> {
  const rows = await target.days.where('date').between(from, to, true, true).toArray()
  return Object.fromEntries(rows.map((r) => [r.date, r.meetingMinutes]))
}

export async function saveMeetingMinutes(date: DateKey, meetingMinutes: number, target: OpenLoopsDB = db): Promise<void> {
  await target.days.put({ date, meetingMinutes })
}

/** ยกงานข้ามวันในธุรกรรมเดียว อ่านข้อมูลล่าสุดเสมอ จึงรันซ้ำได้โดยไม่นับซ้ำ */
export function rollOverDay(today: DateKey, workdays: number[], target: OpenLoopsDB = db): Promise<number> {
  return target.transaction('rw', target.loops, async () => {
    const changed = startDay(await target.loops.toArray(), today, workdays)
    await target.loops.bulkPut(changed)
    return changed.length
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
