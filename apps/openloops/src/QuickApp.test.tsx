// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuickApp } from './QuickApp'
import { allLoops, db } from './db'

afterEach(async () => {
  cleanup()
  await db.loops.clear()
})

function setup() {
  const onHide = vi.fn()
  let show: () => void = () => {}
  const onShow = vi.fn((handler: () => void) => {
    show = handler
    return () => {}
  })
  render(<QuickApp onHide={onHide} onShow={onShow} />)
  return { onHide, show: () => show(), user: userEvent.setup() }
}

const title = () => screen.getByLabelText('ชื่องาน') as HTMLInputElement

describe('quick capture window', () => {
  it('saves with Enter, hides the window and starts a fresh form', async () => {
    const { onHide, user } = setup()
    await waitFor(() => expect(document.activeElement).toBe(title()))
    await user.type(title(), 'โทรหาลูกค้า ABC{Enter}')

    await waitFor(() => expect(onHide).toHaveBeenCalledTimes(1))
    const loops = await allLoops()
    // โหมดง่าย (ค่าเริ่มต้น) จดลงรายการวันนี้
    expect(loops.map((l) => [l.title, l.horizon])).toEqual([['โทรหาลูกค้า ABC', 'today']])
    expect(title().value).toBe('')
  })

  it('closes with Esc without saving, and focuses the title when shown again', async () => {
    const { onHide, show, user } = setup()
    await waitFor(() => expect(document.activeElement).toBe(title()))
    await user.type(title(), 'ร่าง')
    await user.keyboard('{Escape}')
    expect(onHide).toHaveBeenCalledTimes(1)
    expect(await allLoops()).toEqual([])
    expect(title().value).toBe('')

    title().blur()
    act(() => show())
    expect(document.activeElement).toBe(title())
  })
})
