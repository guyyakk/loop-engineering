import { useEffect, useRef, useState } from 'react'
import { AiError, aiErrorText } from './domain/ai'

/** สถานะของการเรียก AI หนึ่งจุดบนหน้าจอ: กำลังรอ, ข้อผิดพลาดเป็นภาษาไทย, ยกเลิกได้ */
export function useAiCall() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = useRef<AbortController | null>(null)

  // ปิดหน้าจอระหว่างรอ ให้ยกเลิกคำขอด้วย
  useEffect(() => () => current.current?.abort(), [])

  async function run<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
    current.current?.abort()
    const controller = new AbortController()
    current.current = controller
    setBusy(true)
    setError(null)
    try {
      return await task(controller.signal)
    } catch (e) {
      const kind = e instanceof AiError ? e.kind : 'request'
      if (kind !== 'cancelled' && current.current === controller) setError(aiErrorText(kind))
      return null
    } finally {
      if (current.current === controller) {
        current.current = null
        setBusy(false)
      }
    }
  }

  return {
    busy,
    error,
    run,
    cancel: () => current.current?.abort(),
    clearError: () => setError(null),
  }
}
