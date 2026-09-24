import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import {
  allLoops,
  getMeetingMinutes,
  claimNotification,
  getMeetings,
  getSent,
  getSettings,
  openDb,
  rollOverDay,
  saveLoop,
  saveMeetingMinutes,
  saveSettings,
} from './db'
import { DEFAULT_SETTINGS } from './domain/capacity'
import { toDateKey } from './domain/dates'
import { createLoop, emptyDraft, newStep, toggleStep } from './domain/loop'

const uniqueName = () => `test-${crypto.randomUUID()}`

describe('db', () => {
  it('keeps loops after the database is closed and opened again (reload)', async () => {
    const name = uniqueName()
    const first = openDb(name)
    const loop = createLoop({ ...emptyDraft('today'), title: 'รายงาน Q3', steps: [newStep('ดึงตัวเลข')] }, new Date())
    await saveLoop(loop, first)
    await saveLoop(toggleStep(loop, loop.steps[0].id, new Date()), first)
    first.close()

    const second = openDb(name)
    const stored = await allLoops(second)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ id: loop.id, title: 'รายงาน Q3', horizon: 'today', status: 'done' })
    expect(stored[0].steps[0].doneAt).not.toBeNull()
    second.close()
  })

  it('upgrades a v1 database without losing loops', async () => {
    const name = uniqueName()
    const legacy = new Dexie(name)
    legacy.version(1).stores({ loops: 'id, status, horizon, dueDate, updatedAt' })
    const base = { project: null, steps: [], energy: null, dueDate: null, estimateMinutes: 60, waitingOn: null }
    const ts = '2026-09-20T03:00:00.000Z'
    const common = { ...base, followUpDate: null, createdAt: ts, updatedAt: ts, lastProgressAt: ts, rolloverCount: 0 }
    await legacy.table('loops').bulkPut([
      { ...common, id: 'open-today', title: 'เปิดอยู่', status: 'active', horizon: 'today', closedAt: null },
      { ...common, id: 'open-week', title: 'สัปดาห์นี้', status: 'blocked', horizon: 'week', closedAt: null },
      { ...common, id: 'done-today', title: 'เสร็จแล้ว', status: 'done', horizon: 'today', closedAt: ts },
    ])
    legacy.close()

    const db = openDb(name)
    const byId = Object.fromEntries((await allLoops(db)).map((l) => [l.id, l]))
    expect(Object.keys(byId).sort()).toEqual(['done-today', 'open-today', 'open-week'])
    expect(byId['open-today']).toMatchObject({ title: 'เปิดอยู่', plannedDate: toDateKey(new Date()), carriedOn: null })
    expect(byId['open-week']).toMatchObject({ plannedDate: null, carriedOn: null })
    expect(byId['done-today']).toMatchObject({ status: 'done', plannedDate: null })
    // อัปเกรดแล้วเปิดวันเดียวกัน ต้องไม่ถือว่าเป็นงานยกมา
    expect(await rollOverDay(toDateKey(new Date()), DEFAULT_SETTINGS.workdays, db)).toBe(0)
    db.close()
  })

  it('stores planner settings and meeting time per day', async () => {
    const db = openDb(uniqueName())
    expect(await getSettings(db)).toEqual(DEFAULT_SETTINGS)
    const custom = { ...DEFAULT_SETTINGS, workMinutes: 420, bufferMinutes: 30, workdays: [1, 2, 3, 4, 5, 6], notify: true }
    await saveSettings(custom, db)
    expect(await getSettings(db)).toEqual(custom)

    // แถวตั้งค่าจาก spec 2 ที่ยังไม่มีค่าที่เพิ่มทีหลัง ต้องได้ค่าเริ่มต้น
    await db.settings.put({ key: 'planner', workMinutes: 480, bufferMinutes: 60 } as never)
    expect(await getSettings(db)).toEqual({ ...DEFAULT_SETTINGS, workMinutes: 480, bufferMinutes: 60 })

    expect(await getMeetingMinutes('2026-09-24', db)).toBe(0)
    await saveMeetingMinutes('2026-09-24', 90, db)
    expect(await getMeetingMinutes('2026-09-24', db)).toBe(90)
    expect(await getMeetingMinutes('2026-09-25', db)).toBe(0)
    await saveMeetingMinutes('2026-09-28', 30, db)
    await saveMeetingMinutes('2026-10-05', 60, db)
    expect(await getMeetings('2026-09-21', '2026-09-27', db)).toEqual({ '2026-09-24': 90 })
    expect(await getMeetings('2026-09-28', '2026-10-04', db)).toEqual({ '2026-09-28': 30 })
    db.close()
  })

  it('rolls a day over once', async () => {
    const db = openDb(uniqueName())
    const loop = createLoop({ ...emptyDraft('today'), title: 'ค้าง' }, new Date(2026, 8, 23, 10))
    await saveLoop(loop, db)
    expect(await rollOverDay('2026-09-24', DEFAULT_SETTINGS.workdays, db)).toBe(1)
    expect(await rollOverDay('2026-09-24', DEFAULT_SETTINGS.workdays, db)).toBe(0)
    const [stored] = await allLoops(db)
    expect(stored).toMatchObject({ rolloverCount: 1, carriedOn: '2026-09-24', plannedDate: '2026-09-24' })
    db.close()
  })

  it('sends each notification kind once per day, even when claimed concurrently', async () => {
    const db = openDb(uniqueName())
    await saveMeetingMinutes('2026-09-24', 60, db)
    const claims = await Promise.all([1, 2, 3].map(() => claimNotification('2026-09-24', 'brief', db)))
    expect(claims.filter(Boolean)).toHaveLength(1)
    expect(await claimNotification('2026-09-24', 'shutdown', db)).toBe(true)
    expect(await claimNotification('2026-09-24', 'shutdown', db)).toBe(false)
    expect(await claimNotification('2026-09-25', 'brief', db)).toBe(true)
    // เวลาประชุมเดิมต้องไม่หาย และตั้งเวลาประชุมใหม่ต้องไม่ล้างสถานะที่ส่งแล้ว
    expect(await getMeetingMinutes('2026-09-24', db)).toBe(60)
    await saveMeetingMinutes('2026-09-24', 90, db)
    expect(Object.keys(await getSent('2026-09-24', db)).sort()).toEqual(['brief', 'shutdown'])
    db.close()
  })
})
