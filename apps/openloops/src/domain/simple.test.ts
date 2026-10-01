import { describe, expect, it } from 'vitest'
import { createLoop, emptyDraft, setStatus, startDay, type Loop, type LoopDraft } from './loop'
import {
  applySimpleEdit,
  doneSince,
  dueOptions,
  endOfMonth,
  historyDays,
  itemBadges,
  simpleDraft,
  startOfMonth,
  tabItems,
  tabOf,
  validateTitle,
} from './simple'

const today = '2026-10-01' // พุธ
const at = (d: number, h = 9, m = 0) => new Date(2026, 9, d, h, m) // ตุลาคม
const atSep = (d: number, h = 9) => new Date(2026, 8, d, h)

function mk(title: string, patch: Partial<LoopDraft> = {}, created = at(1, 8)): Loop {
  return createLoop({ ...emptyDraft('today'), title, ...patch }, created, `id-${title}`)
}

const titles = (loops: Loop[]) => loops.map((l) => l.title)

describe('month helpers', () => {
  it('knows the first and last day of the month', () => {
    expect(startOfMonth('2026-10-17')).toBe('2026-10-01')
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28')
    expect(endOfMonth('2026-12-31')).toBe('2026-12-31')
  })
})

describe('tabs', () => {
  it('puts each loop in its tab, and later loops in this month', () => {
    expect(tabOf(mk('a'))).toBe('today')
    expect(tabOf(mk('b', { horizon: 'week' }))).toBe('week')
    expect(tabOf(mk('c', { horizon: 'month' }))).toBe('month')
    expect(tabOf(mk('d', { horizon: 'later' }))).toBe('month')
  })

  it('also shows loops that are due today or overdue in today, sorted by due date', () => {
    const loops = [
      mk('ไม่กำหนด'),
      mk('ส่งพรุ่งนี้', { dueDate: '2026-10-02' }),
      mk('สัปดาห์ เลยกำหนด', { horizon: 'week', dueDate: '2026-09-29' }),
      mk('เดือน ครบวันนี้', { horizon: 'month', dueDate: today }),
      mk('เดือน ยังไม่ถึง', { horizon: 'month', dueDate: '2026-10-20' }),
    ]
    expect(titles(tabItems(loops, 'today', today).open)).toEqual(['สัปดาห์ เลยกำหนด', 'เดือน ครบวันนี้', 'ส่งพรุ่งนี้', 'ไม่กำหนด'])
    expect(titles(tabItems(loops, 'week', today).open)).toEqual(['สัปดาห์ เลยกำหนด'])
    expect(titles(tabItems(loops, 'month', today).open)).toEqual(['เดือน ครบวันนี้', 'เดือน ยังไม่ถึง'])
  })

  it('keeps done loops faded in the tab until the period ends', () => {
    const doneOn = (l: Loop, d: Date) => setStatus(l, 'done', d)
    const loops = [
      doneOn(mk('วันนี้เสร็จ'), at(1, 10)),
      doneOn(mk('เมื่อวานเสร็จ', {}, atSep(30)), atSep(30, 17)),
      doneOn(mk('สัปดาห์ จันทร์', { horizon: 'week' }, atSep(28)), atSep(28, 11)),
      doneOn(mk('สัปดาห์ ก่อน', { horizon: 'week' }, atSep(25)), atSep(25, 11)),
      doneOn(mk('เดือน วันนี้', { horizon: 'month' }), at(1, 11)),
      doneOn(mk('เดือน ก่อน', { horizon: 'month' }, atSep(29)), atSep(30, 9)),
      setStatus(mk('ทิ้ง'), 'dropped', at(1, 12)),
    ]
    expect(titles(tabItems(loops, 'today', today).done)).toEqual(['วันนี้เสร็จ'])
    expect(titles(tabItems(loops, 'week', today).done)).toEqual(['สัปดาห์ จันทร์'])
    expect(titles(tabItems(loops, 'month', today).done)).toEqual(['เดือน วันนี้'])
  })

  it('shows a due-today loop from another tab in today’s done list when ticked today', () => {
    const loop = setStatus(mk('รายงาน', { horizon: 'week', dueDate: today }), 'done', at(1, 15))
    expect(titles(tabItems([loop], 'today', today).done)).toEqual(['รายงาน'])
    expect(titles(tabItems([loop], 'week', today).done)).toEqual(['รายงาน'])
  })
})

describe('badges', () => {
  const text = (l: Loop, tab: 'today' | 'week' | 'month') => itemBadges(l, tab, today).map((b) => b.text)

  it('describes due dates and where the loop came from', () => {
    expect(text(mk('a', { dueDate: '2026-09-29' }), 'today')).toEqual(['เลยกำหนด 2 วัน'])
    expect(text(mk('b', { horizon: 'month', dueDate: today }), 'today')).toEqual(['ครบกำหนดวันนี้', 'จากเดือนนี้'])
    expect(text(mk('c', { dueDate: '2026-10-02' }), 'today')).toEqual(['ภายในพรุ่งนี้'])
    expect(text(mk('d', { horizon: 'week' }, atSep(24)), 'week')).toEqual(['จากสัปดาห์ก่อน'])
    expect(text(mk('e', { horizon: 'later' }, atSep(20)), 'month')).toEqual(['จากเดือนก่อน', 'ไว้ก่อน'])
    expect(text(setStatus(mk('f'), 'done', at(1, 10)), 'today')).toEqual([])
  })

  it('says a today loop was carried over from yesterday', () => {
    const yesterday = mk('ค้าง', {}, atSep(30))
    const [carried] = startDay([yesterday], today)
    expect(text(carried, 'today')).toEqual(['ค้างจากเมื่อวาน'])
  })
})

describe('history', () => {
  it('groups done loops by the day they were ticked, newest first', () => {
    const loops = [
      setStatus(mk('a'), 'done', at(1, 9)),
      setStatus(mk('b'), 'done', at(1, 16)),
      setStatus(mk('c', {}, atSep(28)), 'done', atSep(29, 10)),
      setStatus(mk('d'), 'dropped', at(1, 10)),
      mk('e'),
    ]
    const days = historyDays(loops)
    expect(days.map((d) => [d.date, titles(d.items)])).toEqual([
      ['2026-10-01', ['b', 'a']],
      ['2026-09-29', ['c']],
    ])
    expect(historyDays(loops, 1)).toHaveLength(1)
    expect(doneSince(loops, '2026-09-28')).toBe(3)
    expect(doneSince(loops, today)).toBe(2)
  })
})

describe('adding and editing', () => {
  it('validates titles and drops duplicate due options', () => {
    expect(validateTitle('  ')).toBe('ใส่ชื่องานก่อน')
    expect(validateTitle('ก'.repeat(201))).toContain('200')
    expect(validateTitle(' ส่งงาน ')).toBeNull()
    // ศุกร์ 2 ต.ค. 2026: "ศุกร์นี้" คือวันเดียวกับ "วันนี้"
    expect(dueOptions('2026-10-02').map((o) => o.label)).toEqual(['ไม่กำหนด', 'วันนี้', 'พรุ่งนี้', 'สิ้นเดือน'])
    expect(dueOptions(today).map((o) => o.value)).toEqual([null, today, '2026-10-02', '2026-10-02', '2026-10-31'].filter((v, i, a) => a.indexOf(v) === i))
  })

  it('creates a loop in the chosen tab', () => {
    const loop = createLoop(simpleDraft({ title: ' ทำสไลด์ ', tab: 'month', dueDate: '2026-10-20' }), at(1, 10))
    expect(loop).toMatchObject({ title: 'ทำสไลด์', horizon: 'month', dueDate: '2026-10-20', plannedDate: null })
  })

  it('moves tabs only when the tab really changes', () => {
    const later = mk('ไว้ก่อน', { horizon: 'later' })
    const renamed = applySimpleEdit(later, { title: 'ชื่อใหม่', tab: 'month', dueDate: null }, at(1, 12))
    expect(renamed).toMatchObject({ title: 'ชื่อใหม่', horizon: 'later' })
    const moved = applySimpleEdit(later, { title: 'ไว้ก่อน', tab: 'today', dueDate: today }, at(1, 12))
    expect(moved).toMatchObject({ horizon: 'today', plannedDate: today, dueDate: today })
  })
})
