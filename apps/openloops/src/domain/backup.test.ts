import { describe, expect, it } from 'vitest'
import {
  BACKUP_FORMAT,
  backupFileName,
  backupReminder,
  makeBackup,
  mergeBackup,
  parseBackup,
  type Backup,
} from './backup'
import { DEFAULT_SETTINGS } from './capacity'
import type { DayPlan } from './day'
import { createLoop, emptyDraft, newStep, setStatus, toggleStep, type Loop } from './loop'

const now = new Date(2026, 8, 25, 14, 30)

function mk(title: string, at = now): Loop {
  return createLoop({ ...emptyDraft('today'), title, estimateMinutes: 60, steps: [newStep('a'), newStep('b')] }, at, title)
}

function sample(): Backup {
  let a = mk('a')
  a = toggleStep(a, a.steps[0].id, now)
  const waiting = setStatus(mk('w'), 'waiting', now, { waitingOn: 'พี่นก', followUpDate: '2026-09-29' })
  const done = setStatus(mk('d'), 'done', now)
  const days: DayPlan[] = [{ date: '2026-09-24', meetingMinutes: 60, shutdownAt: now.toISOString(), note: 'โน้ต', sent: { brief: now.toISOString() } }]
  return makeBackup([a, waiting, done], days, { ...DEFAULT_SETTINGS, particle: 'ค่ะ', workdays: [1, 2, 3, 4, 5, 6] }, now)
}

const errorOf = (text: string) => {
  const r = parseBackup(text)
  return r.ok ? null : r.error
}

describe('export', () => {
  it('names the file by local date and tags the format', () => {
    expect(backupFileName(now)).toBe('openloops-backup-2026-09-25.json')
    expect(sample()).toMatchObject({ app: 'openloops', format: BACKUP_FORMAT, exportedAt: now.toISOString() })
  })

  it('round-trips through JSON unchanged, including closed loops, days and settings', () => {
    const backup = sample()
    const result = parseBackup(JSON.stringify(backup, null, 2))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.backup).toEqual(backup)
    expect(result.summary).toMatchObject({ loops: 3, open: 2, closed: 1, days: 1 })
  })
})

describe('import validation', () => {
  const base = () => JSON.parse(JSON.stringify(sample()))

  it('rejects files that are not OpenLoops backups', () => {
    expect(errorOf('not json')).toContain('ไม่ใช่ JSON')
    expect(errorOf('[]')).toContain('ไม่ใช่ไฟล์สำรองของ OpenLoops')
    expect(errorOf(JSON.stringify({ app: 'other', loops: [] }))).toContain('ไม่ใช่ไฟล์สำรองของ OpenLoops')
    expect(errorOf(JSON.stringify({ ...base(), format: BACKUP_FORMAT + 1 }))).toContain('รุ่นที่ใหม่กว่า')
    expect(errorOf(JSON.stringify({ ...base(), loops: 'x' }))).toContain('ไม่มีรายการงาน')
  })

  it('rejects the whole file when one loop is broken, and says which one', () => {
    const b = base()
    delete b.loops[1].title
    expect(errorOf(JSON.stringify(b))).toBe('งานลำดับที่ 2 ในไฟล์ข้อมูลไม่ครบ (ไม่มีชื่องาน) จึงยังไม่นำเข้าอะไรเลย')

    const c = base()
    c.loops[0].status = 'finished'
    expect(errorOf(JSON.stringify(c))).toContain('สถานะไม่ถูกต้อง')

    const d = base()
    d.loops[1].waitingOn = null
    expect(errorOf(JSON.stringify(d))).toContain('รอคนอื่นแต่ไม่มีชื่อคน')

    const e = base()
    e.loops[2].id = e.loops[0].id
    expect(errorOf(JSON.stringify(e))).toContain('id ซ้ำ')

    const f = base()
    f.days[0].date = '25/09/2026'
    expect(errorOf(JSON.stringify(f))).toContain('ข้อมูลรายวันลำดับที่ 1')
  })

  it('fills optional fields that older files do not have', () => {
    const b = base()
    for (const key of ['plannedDate', 'carriedOn', 'rolloverCount', 'lastProgressAt', 'energy', 'project']) delete b.loops[0][key]
    b.settings = { workMinutes: 420 }
    const result = parseBackup(JSON.stringify(b))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.backup.loops[0]).toMatchObject({ plannedDate: null, carriedOn: null, rolloverCount: 0, energy: null, project: null })
    expect(result.backup.loops[0].lastProgressAt).toBe(result.backup.loops[0].updatedAt)
    expect(result.backup.settings).toEqual({ ...DEFAULT_SETTINGS, workMinutes: 420 })
  })

  it('stores timestamps as UTC ISO so "newer" comparisons stay correct', () => {
    const b = base()
    b.loops[0].updatedAt = '2026-09-25T21:30:00+07:00'
    const result = parseBackup(JSON.stringify(b))
    expect(result.ok && result.backup.loops[0].updatedAt).toBe('2026-09-25T14:30:00.000Z')
  })
})

describe('merge', () => {
  it('adds new loops, takes the newer copy of existing ones, and only fills missing days', () => {
    const backup = sample()
    const [a, w] = backup.loops
    const mineNewer = { ...a, title: 'แก้ในเครื่อง', updatedAt: '2026-09-26T00:00:00.000Z' }
    const mineOlder = { ...w, title: 'เก่า', updatedAt: '2026-01-01T00:00:00.000Z' }
    const plan = mergeBackup(
      { loops: [mineNewer, mineOlder], days: [{ date: '2026-09-24', meetingMinutes: 120 }] },
      { ...backup, days: [...backup.days, { date: '2026-09-25', meetingMinutes: 30 }] },
    )
    expect(plan).toMatchObject({ added: 1, updated: 1, kept: 1 })
    expect(plan.loops.map((l) => l.title)).toEqual(['w', 'd'])
    expect(plan.days.map((d) => d.date)).toEqual(['2026-09-25'])
  })
})

describe('backup reminder', () => {
  it('asks once there is enough work and no backup, or the last one is a week old', () => {
    expect(backupReminder(null, 4, '2026-09-25', null)).toBe(false)
    expect(backupReminder(null, 5, '2026-09-25', null)).toBe(true)
    expect(backupReminder('2026-09-20T10:00:00.000Z', 20, '2026-09-25', null)).toBe(false)
    expect(backupReminder('2026-09-18T10:00:00.000Z', 20, '2026-09-25', null)).toBe(true)
    expect(backupReminder(null, 20, '2026-09-25', '2026-09-25')).toBe(false)
    expect(backupReminder(null, 20, '2026-09-26', '2026-09-25')).toBe(true)
  })
})

describe('calendar fields in backups', () => {
  it('keeps the client id and per-day calendar minutes, and drops an invalid client id', () => {
    const backup = makeBackup(
      [],
      [{ date: '2026-09-24', meetingMinutes: 0, calendarMinutes: 90 }],
      { ...DEFAULT_SETTINGS, googleClientId: '123-abc.apps.googleusercontent.com', calendarEnabled: true, calendarSyncedAt: now.toISOString() },
      now,
    )
    const ok = parseBackup(JSON.stringify(backup))
    expect(ok.ok && ok.backup).toEqual(backup)

    const tampered = JSON.parse(JSON.stringify(backup))
    tampered.settings.googleClientId = 'not a client id'
    tampered.settings.accessToken = 'should-never-be-kept'
    const result = parseBackup(JSON.stringify(tampered))
    expect(result.ok && result.backup.settings.googleClientId).toBeNull()
    expect(JSON.stringify(result)).not.toContain('should-never-be-kept')
  })
})
