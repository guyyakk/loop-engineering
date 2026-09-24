import { useEffect, useRef, useState } from 'react'
import { currentToken, disconnect as revokeToken, fetchBusy, loadGis, requestToken } from './calendarClient'
import { clearCalendarBusy, saveCalendarBusy, saveSettings } from './db'
import {
  CalendarError,
  busyMinutesByDay,
  calendarErrorText,
  shouldAutoSync,
  syncRange,
  tokenValid,
  type CalendarToken,
} from './domain/calendar'
import type { PlannerSettings } from './domain/capacity'
import type { DateKey } from './domain/dates'

export interface CalendarControls {
  syncing: boolean
  error: string | null
  hasToken: boolean
  /** ต้องเรียกจากการกดของผู้ใช้ เพราะอาจเปิดหน้าต่างขอสิทธิ์ของ Google */
  connect: () => void
  disconnect: () => Promise<void>
}

/**
 * เชื่อม Google Calendar: ขอสิทธิ์เมื่อผู้ใช้กด, ซิงก์เองเงียบ ๆ เมื่อยังมี token ที่ใช้ได้
 * `ready` = โหลดการตั้งค่าจริงจากฐานข้อมูลแล้ว (ก่อนหน้านั้นเป็นค่าเริ่มต้น)
 */
export function useCalendar(settings: PlannerSettings, ready: boolean, today: DateKey): CalendarControls {
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasToken, setHasToken] = useState(() => tokenValid(currentToken(), Date.now()))
  const latest = useRef({ settings, today })
  latest.current = { settings, today }
  const running = useRef(false)

  // โหลดสคริปต์ของ Google ไว้ก่อน ตอนกดจะได้เปิดหน้าต่างขอสิทธิ์ได้ทันที
  useEffect(() => {
    if (settings.googleClientId) loadGis().catch(() => undefined)
  }, [settings.googleClientId])

  async function run(getToken: () => Promise<CalendarToken>) {
    if (running.current) return
    running.current = true
    setSyncing(true)
    setError(null)
    try {
      const token = await getToken()
      const { settings: s, today: day } = latest.current
      const busy = await fetchBusy(day, token)
      await saveCalendarBusy(busyMinutesByDay(busy, syncRange(day).days, s.startMinutes, s.workMinutes))
      await saveSettings({ ...latest.current.settings, calendarEnabled: true, calendarSyncedAt: new Date().toISOString() })
    } catch (e) {
      setError(calendarErrorText(e instanceof CalendarError ? e.kind : 'unknown'))
    } finally {
      running.current = false
      setSyncing(false)
      setHasToken(tokenValid(currentToken(), Date.now()))
    }
  }

  function connect() {
    const clientId = settings.googleClientId
    if (!clientId) return
    const token = currentToken()
    if (tokenValid(token, Date.now())) {
      void run(async () => token!)
      return
    }
    let request: Promise<CalendarToken>
    try {
      // เรียกในจังหวะที่ผู้ใช้กดเลย ห้ามรออะไรก่อน ไม่เช่นนั้น browser จะบล็อก popup
      request = requestToken(clientId, settings.calendarEnabled ? '' : 'consent')
    } catch (e) {
      setError(calendarErrorText(e instanceof CalendarError ? e.kind : 'unknown'))
      loadGis().catch(() => undefined)
      return
    }
    void run(() => request)
  }

  async function disconnect() {
    revokeToken()
    await clearCalendarBusy()
    await saveSettings({ ...latest.current.settings, calendarEnabled: false, calendarSyncedAt: null })
    setError(null)
    setHasToken(false)
  }

  // ซิงก์เองเมื่อเปิดแอป ข้ามวัน หรือกลับมาที่หน้าต่าง ถ้ายังมี token และซิงก์ครั้งล่าสุดนานพอแล้ว
  useEffect(() => {
    if (!ready || !settings.calendarEnabled) return
    const tick = () => {
      const token = currentToken()
      if (shouldAutoSync(Date.now(), token, latest.current.settings.calendarSyncedAt)) void run(async () => token!)
      else setHasToken(tokenValid(token, Date.now()))
    }
    tick()
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [ready, settings.calendarEnabled, today])

  // เปลี่ยนเวลางานแล้วนาทีไม่ว่างต้องคิดใหม่ ซิงก์ทันทีถ้ายังมี token
  const hours = `${settings.startMinutes}-${settings.workMinutes}`
  const firstHours = useRef(hours)
  useEffect(() => {
    if (hours === firstHours.current) return
    firstHours.current = hours
    const token = currentToken()
    if (settings.calendarEnabled && tokenValid(token, Date.now())) void run(async () => token!)
  }, [hours])

  return { syncing, error, hasToken, connect, disconnect }
}
