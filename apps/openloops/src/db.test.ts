import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import {
  allLoops,
  getMeetingMinutes,
  claimNotification,
  clearCalendarBusy,
  commitRitual,
  getBusy,
  getAiConfig,
  getBusyRange,
  getDays,
  getMeetings,
  getSent,
  getSettings,
  openDb,
  putMerged,
  readAll,
  replaceAll,
  rollOverDay,
  saveAiConfig,
  saveLoop,
  saveCalendarBusy,
  saveLoops,
  saveMeetingMinutes,
  saveSettings,
  undoRitual,
} from './db'
import { makeBackup, mergeBackup, parseBackup } from './domain/backup'
import { DEFAULT_SETTINGS } from './domain/capacity'
import { toDateKey } from './domain/dates'
import { createLoop, emptyDraft, newStep, setStatus, toggleStep } from './domain/loop'

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

  it('commits a ritual atomically and can undo it, including the day row', async () => {
    const db = openDb(uniqueName())
    const loop = createLoop({ ...emptyDraft('today'), title: 'ทำต่อ' }, new Date(2026, 8, 24, 9))
    await saveLoop(loop, db)
    await saveMeetingMinutes('2026-09-24', 60, db)

    const carried = { ...loop, horizon: 'week' as const, plannedDate: '2026-09-25', rolloverCount: 1 }
    const before = await commitRitual('2026-09-24', [carried], { shutdownAt: 'T17', note: 'พรุ่งนี้โทรหาลูกค้า' }, db)
    expect(before).toMatchObject({ date: '2026-09-24', meetingMinutes: 60 })
    expect((await allLoops(db))[0]).toMatchObject({ plannedDate: '2026-09-25', rolloverCount: 1 })
    expect((await getDays('2026-09-24', '2026-09-24', db))[0]).toMatchObject({ meetingMinutes: 60, shutdownAt: 'T17', note: 'พรุ่งนี้โทรหาลูกค้า' })

    await undoRitual('2026-09-24', [loop], before, db)
    expect((await allLoops(db))[0]).toMatchObject({ horizon: 'today', rolloverCount: 0 })
    const [day] = await getDays('2026-09-24', '2026-09-24', db)
    expect(day.shutdownAt).toBeUndefined()
    expect(day.meetingMinutes).toBe(60)

    // วันที่ไม่เคยมีแถวมาก่อน เลิกทำแล้วต้องไม่เหลือแถวค้าง
    const none = await commitRitual('2026-09-26', [], { reviewAt: 'T' }, db)
    await undoRitual('2026-09-26', [], none, db)
    expect(await getDays('2026-09-26', '2026-09-26', db)).toEqual([])
    db.close()
  })

  it('restores a backup into an empty database on another machine with every field intact', async () => {
    const source = openDb(uniqueName())
    const at = new Date(2026, 8, 25, 10)
    let a = createLoop({ ...emptyDraft('today'), title: 'ใบเสนอราคา', estimateMinutes: 120, steps: [newStep('ขอราคา'), newStep('ส่ง')] }, at)
    a = toggleStep(a, a.steps[0].id, at)
    const b = setStatus(createLoop({ ...emptyDraft('week'), title: 'รอพี่นก' }, at), 'waiting', at, { waitingOn: 'พี่นก', followUpDate: '2026-09-29' })
    const c = setStatus(createLoop({ ...emptyDraft('later'), title: 'ปิดแล้ว' }, at), 'dropped', at)
    await saveLoops([a, b, c], source)
    await saveMeetingMinutes('2026-09-25', 90, source)
    await commitRitual('2026-09-25', [], { shutdownAt: at.toISOString(), note: 'โน้ต' }, source)
    await saveSettings({ ...DEFAULT_SETTINGS, workMinutes: 420, particle: 'ครับ' }, source)

    const exported = await readAll(source)
    const text = JSON.stringify(makeBackup(exported.loops, exported.days, exported.settings, at))
    source.close()

    const fresh = openDb(uniqueName())
    const parsed = parseBackup(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    await replaceAll(parsed.backup, fresh)
    const restored = await readAll(fresh)
    const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((x, y) => x.id.localeCompare(y.id))
    expect(byId(restored.loops)).toEqual(byId(exported.loops))
    expect(restored.days).toEqual(exported.days)
    expect(restored.settings).toEqual(exported.settings)
    fresh.close()
  })

  it('replaceAll wipes old data, and merging keeps local newer edits', async () => {
    const db = openDb(uniqueName())
    const at = new Date(2026, 8, 25, 10)
    const old = createLoop({ ...emptyDraft('today'), title: 'ของเดิม' }, at)
    await saveLoops([old], db)
    await saveMeetingMinutes('2026-09-24', 30, db)
    const snapshot = await readAll(db)

    const incoming = createLoop({ ...emptyDraft('week'), title: 'จากไฟล์' }, at)
    await replaceAll({ loops: [incoming], days: [], settings: DEFAULT_SETTINGS }, db)
    expect((await readAll(db)).loops.map((l) => l.title)).toEqual(['จากไฟล์'])
    expect((await readAll(db)).days).toEqual([])

    // เลิกทำการนำเข้า = แทนที่ด้วยข้อมูลก่อนหน้า
    await replaceAll(snapshot, db)
    const back = await readAll(db)
    expect(back.loops).toEqual(snapshot.loops)
    expect(back.days).toEqual(snapshot.days)

    const plan = mergeBackup(back, makeBackup([incoming, { ...old, title: 'เก่ากว่า', updatedAt: '2020-01-01T00:00:00.000Z' }], [], DEFAULT_SETTINGS, at))
    await putMerged(plan.loops, plan.days, db)
    expect((await readAll(db)).loops.map((l) => l.title).sort()).toEqual(['ของเดิม', 'จากไฟล์'])
    db.close()
  })

  it('stores calendar minutes next to manual time, and disconnect removes only the calendar part', async () => {
    const db = openDb(uniqueName())
    await saveMeetingMinutes('2026-09-24', 30, db)
    await commitRitual('2026-09-24', [], { shutdownAt: 'T' }, db)
    expect(await getBusy('2026-09-24', db)).toEqual({ manual: 30, calendar: null })

    await saveCalendarBusy({ '2026-09-24': 120, '2026-09-25': 0 }, db)
    expect(await getBusy('2026-09-24', db)).toEqual({ manual: 30, calendar: 120 })
    expect(await getBusyRange('2026-09-21', '2026-09-27', db)).toEqual({
      '2026-09-24': { manual: 30, calendar: 120 },
      '2026-09-25': { manual: 0, calendar: 0 },
    })
    // ข้อมูลอื่นของวันต้องไม่หาย
    expect((await getDays('2026-09-24', '2026-09-24', db))[0].shutdownAt).toBe('T')

    await clearCalendarBusy(db)
    expect(await getBusy('2026-09-24', db)).toEqual({ manual: 30, calendar: null })
    expect(await getBusy('2026-09-25', db)).toEqual({ manual: 0, calendar: null })
    db.close()
  })

  it('keeps the AI key on this device only: not in snapshots, and not wiped by a replace import', async () => {
    const db = openDb(uniqueName())
    expect(await getAiConfig(db)).toEqual({ apiKey: null, model: 'claude-opus-5-5' })
    await saveAiConfig({ apiKey: ' sk-ant-secret-1234567890abcdefghij ', model: 'claude-sonnet-5' }, db)
    expect(await getAiConfig(db)).toEqual({ apiKey: 'sk-ant-secret-1234567890abcdefghij', model: 'claude-sonnet-5' })

    const snapshot = await readAll(db)
    expect(JSON.stringify(snapshot)).not.toContain('sk-ant-')
    await replaceAll({ loops: [], days: [], settings: DEFAULT_SETTINGS }, db)
    expect((await getAiConfig(db)).apiKey).toBe('sk-ant-secret-1234567890abcdefghij')

    await saveAiConfig({ apiKey: null, model: 'claude-sonnet-5' }, db)
    expect((await getAiConfig(db)).apiKey).toBeNull()
    db.close()
  })
})
