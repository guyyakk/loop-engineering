// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { createLoop, setStatus, type Loop } from '../domain/loop'
import { simpleDraft, type SimpleValues } from '../domain/simple'
import { SimpleView, type SimpleViewName } from './SimpleView'

afterEach(cleanup)

const today = '2026-10-01'
const now = new Date(2026, 9, 1, 9)

/** ห่อ SimpleView ด้วย state จริง แทนฐานข้อมูล */
function Harness({ initial = [], view = 'today' }: { initial?: Loop[]; view?: SimpleViewName }) {
  const [loops, setLoops] = useState(initial)
  return (
    <SimpleView
      loops={loops}
      today={today}
      view={view}
      onAdd={(values: SimpleValues) => setLoops((ls) => [...ls, createLoop(simpleDraft(values), now)])}
      onToggle={(loop) =>
        setLoops((ls) => ls.map((l) => (l.id === loop.id ? setStatus(l, l.status === 'done' ? 'active' : 'done', now) : l)))
      }
      onOpen={() => {}}
    />
  )
}

describe('SimpleView', () => {
  it('adds tasks with Enter and keeps the cursor in the box for the next one', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const box = screen.getByLabelText('เพิ่มงานวันนี้')
    await user.type(box, 'โทรหาลูกค้า{Enter}')
    await user.click(within(screen.getByRole('radiogroup', { name: 'เสร็จภายใน' })).getByRole('radio', { name: 'สิ้นเดือน' }))
    await user.type(box, 'ส่งรายงาน{Enter}')

    expect(document.activeElement).toBe(box)
    expect((box as HTMLInputElement).value).toBe('')
    const items = screen.getAllByRole('listitem')
    expect(items.map((li) => li.querySelector('.task-title')?.textContent)).toEqual(['ส่งรายงาน', 'โทรหาลูกค้า'])
    expect(items[0].textContent).toContain('ภายใน')
    // เลือกวันแล้วรีเซ็ตกลับเป็นไม่กำหนดหลังเพิ่ม
    expect(screen.getByRole('radio', { name: 'ไม่กำหนด' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('link', { name: /วันนี้/ }).textContent).toBe('วันนี้2')
  })

  it('fades a ticked task into "ทำแล้ว" and can untick it', async () => {
    const user = userEvent.setup()
    const loop = createLoop(simpleDraft({ title: 'ตอบอีเมล', tab: 'today', dueDate: null }), now)
    render(<Harness initial={[loop]} />)

    await user.click(screen.getByRole('checkbox', { name: 'เสร็จแล้ว: ตอบอีเมล' }))
    expect(screen.getByRole('heading', { name: 'ทำแล้ว 1' })).toBeTruthy()
    const row = screen.getByRole('checkbox', { name: 'ยังไม่เสร็จ: ตอบอีเมล' }).closest('li')!
    expect(row.getAttribute('data-done')).toBe('true')
    expect(row.textContent).toContain('เสร็จวันนี้')
    expect(screen.getByText(/ทำครบทุกงานในวันนี้แล้ว/)).toBeTruthy()

    await user.click(screen.getByRole('checkbox', { name: 'ยังไม่เสร็จ: ตอบอีเมล' }))
    expect(screen.queryByRole('heading', { name: /ทำแล้ว/ })).toBeNull()
  })

  it('lists finished tasks by day in history', () => {
    const done = setStatus(createLoop(simpleDraft({ title: 'จองห้อง', tab: 'week', dueDate: null }), now), 'done', now)
    render(<Harness initial={[done]} view="history" />)
    expect(screen.getByRole('heading', { name: /วันนี้/ }).textContent).toContain('1')
    const row = screen.getByRole('checkbox', { name: 'ยังไม่เสร็จ: จองห้อง' }).closest('li')!
    expect(row.textContent).toContain('แผนสัปดาห์')
    expect(row.textContent).toContain('เสร็จ 09:00')
    expect(screen.getByText(/สัปดาห์นี้ทำเสร็จ/).textContent).toContain('1')
  })
})
