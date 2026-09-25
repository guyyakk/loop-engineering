import { afterEach, describe, expect, it, vi } from 'vitest'

// จำลองการอยู่ในแอป Windows โดยไม่ต้องมี Tauri จริง
const desktop = vi.hoisted(() => ({ isDesktop: vi.fn(() => true), desktopNotify: vi.fn() }))
vi.mock('./desktop', () => desktop)

import { permissionState, requestPermission, showNotification } from './notifier'

afterEach(() => vi.clearAllMocks())

describe('notifier in the Windows app', () => {
  it('uses Windows notifications without asking the browser for permission', async () => {
    expect(permissionState()).toBe('granted')
    expect(await requestPermission()).toBe('granted')
    const shown = await showNotification({ title: 'สรุปแผนวันนี้', body: 'วางงานไว้ 3 ชม.' }, 'openloops-brief', '/')
    expect(shown).toBe(true)
    expect(desktop.desktopNotify).toHaveBeenCalledWith('สรุปแผนวันนี้', 'วางงานไว้ 3 ชม.')
  })

  it('falls back to the browser path outside the Windows app', async () => {
    desktop.isDesktop.mockReturnValue(false)
    // สภาพแวดล้อม node ไม่มี Notification
    expect(permissionState()).toBe('unsupported')
    expect(await showNotification({ title: 't', body: 'b' }, 'x', '/')).toBe(false)
    expect(desktop.desktopNotify).not.toHaveBeenCalled()
  })
})
