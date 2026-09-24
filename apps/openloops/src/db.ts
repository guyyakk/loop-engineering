import Dexie, { type EntityTable } from 'dexie'
import type { Loop } from './domain/loop'

// ข้อมูลทั้งหมดอยู่ใน IndexedDB ของเครื่องนี้ ไม่มี server
export type OpenLoopsDB = Dexie & { loops: EntityTable<Loop, 'id'> }

export function openDb(name = 'openloops'): OpenLoopsDB {
  const db = new Dexie(name) as OpenLoopsDB
  db.version(1).stores({ loops: 'id, status, horizon, dueDate, updatedAt' })
  return db
}

export const db = openDb()

export function saveLoop(loop: Loop, target: OpenLoopsDB = db): Promise<string> {
  return target.loops.put(loop)
}

export function allLoops(target: OpenLoopsDB = db): Promise<Loop[]> {
  return target.loops.toArray()
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
