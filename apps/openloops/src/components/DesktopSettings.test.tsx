// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const desktop = vi.hoisted(() => ({
  QUICK_SHORTCUT_LABEL: 'Ctrl+Alt+N',
  shortcutReady: vi.fn(async () => true),
  autostartEnabled: vi.fn(async () => false),
  setAutostart: vi.fn(async (on: boolean) => on),
}))
vi.mock('../desktop', () => desktop)

import { DesktopSettings } from './DesktopSettings'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DesktopSettings', () => {
  it('says the shortcut works and turns start-with-Windows on', async () => {
    const user = userEvent.setup()
    render(<DesktopSettings />)
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('กด Ctrl+Alt+N'))
    const toggle = screen.getByRole('button', { name: 'เปิดพร้อม Windows' })
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false))
    await user.click(toggle)
    expect(desktop.setAutostart).toHaveBeenCalledWith(true)
    expect(screen.getByRole('button', { name: 'เปิดพร้อม Windows อยู่' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('tells the user when another program owns the shortcut, and when autostart fails', async () => {
    desktop.shortcutReady.mockResolvedValueOnce(false)
    desktop.setAutostart.mockRejectedValueOnce(new Error('registry'))
    const user = userEvent.setup()
    render(<DesktopSettings />)
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('โปรแกรมอื่นจองไว้'))
    const toggle = screen.getByRole('button', { name: 'เปิดพร้อม Windows' })
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false))
    await user.click(toggle)
    expect(screen.getByRole('alert').textContent).toContain('ไม่สำเร็จ')
  })
})
