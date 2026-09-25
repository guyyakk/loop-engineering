import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { makeAssist } from './aiClient'
import { CaptureForm } from './components/CaptureForm'
import { allLoops, getAiConfig, getSettings, saveLoop } from './db'
import { DEFAULT_SETTINGS } from './domain/capacity'
import { toDateKey } from './domain/dates'
import { createLoop, emptyDraft, projectsOf, type LoopDraft } from './domain/loop'

interface Props {
  /** ซ่อนหน้าต่างนี้ (ในแอป Windows) */
  onHide: () => void
  /** ฟังการเปิดหน้าต่างอีกครั้ง คืนฟังก์ชันเลิกฟัง */
  onShow: (handler: () => void) => () => void
}

const focusTitle = () => document.querySelector<HTMLElement>('[data-autofocus]')?.focus()

/**
 * หน้าต่างจดงานด่วน (Ctrl+Alt+N): มีแค่ฟอร์มจดงาน บันทึกแล้วหน้าต่างหายไป
 * ไม่ยกงานข้ามวัน ไม่แจ้งเตือน ไม่ซิงก์ปฏิทิน เพราะเป็นหน้าที่ของหน้าต่างหลัก
 */
export function QuickApp({ onHide, onShow }: Props) {
  const loops = useLiveQuery(() => allLoops(), [])
  const settings = useLiveQuery(() => getSettings(), []) ?? DEFAULT_SETTINGS
  const aiConfig = useLiveQuery(() => getAiConfig(), [])
  const [today, setToday] = useState(() => toDateKey(new Date()))
  // เปลี่ยน key เพื่อเริ่มฟอร์มใหม่หลังบันทึกหรือยกเลิก งานที่พิมพ์ค้างตอนคลิกไปที่อื่นยังอยู่
  const [round, setRound] = useState(0)
  const projects = useMemo(() => projectsOf(loops ?? []), [loops])
  const workdays = settings.workdays
  const ai = useMemo(
    () => (aiConfig?.apiKey ? makeAssist({ apiKey: aiConfig.apiKey, model: aiConfig.model }, { today, workdays, projects }) : null),
    [aiConfig, today, workdays, projects],
  )

  useEffect(
    () =>
      onShow(() => {
        setToday(toDateKey(new Date()))
        focusTitle()
      }),
    [onShow],
  )

  // เริ่มฟอร์มใหม่แล้วให้พิมพ์ต่อได้ทันที
  useEffect(() => {
    focusTitle()
  }, [round])

  function close() {
    setRound((r) => r + 1)
    onHide()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function save(draft: LoopDraft) {
    await saveLoop(createLoop(draft, new Date()))
    close()
  }

  return (
    <main className="quick-app">
      <CaptureForm
        key={round}
        mode="create"
        initial={emptyDraft('week')}
        projects={projects}
        today={today}
        onSave={(draft) => void save(draft)}
        onCancel={close}
        ai={ai}
      />
    </main>
  )
}
