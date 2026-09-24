import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CaptureForm } from './components/CaptureForm'
import { Icon, Logo } from './components/Icon'
import { LoopCard } from './components/LoopCard'
import { TodayPanel } from './components/TodayPanel'
import {
  allLoops,
  getMeetingMinutes,
  getSettings,
  rollOverDay,
  saveLoop,
  saveLoops,
  saveMeetingMinutes,
  saveSettings,
} from './db'
import { DEFAULT_SETTINGS, computeDayLoad } from './domain/capacity'
import { formatLongDay, toDateKey } from './domain/dates'
import {
  HORIZON_LABEL,
  applyDraft,
  createLoop,
  draftFromLoop,
  emptyDraft,
  groupLoops,
  isClosed,
  postponeToTomorrow,
  projectsOf,
  type Horizon,
  type Loop,
  type LoopDraft,
} from './domain/loop'

type Editing = { mode: 'create'; draft: LoopDraft } | { mode: 'edit'; loop: Loop }
/** undo เก็บสภาพก่อนเปลี่ยนของทุกลูปที่ถูกแก้ในครั้งนั้น */
type Toast = { message: string; undo: Loop[] }

/** date key ของวันนี้ ที่อัปเดตเองเมื่อกลับมาเปิดแอปข้ามวัน */
function useToday(): string {
  const [today, setToday] = useState(() => toDateKey(new Date()))
  useEffect(() => {
    const refresh = () => setToday(toDateKey(new Date()))
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    const timer = window.setInterval(refresh, 60_000)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      window.clearInterval(timer)
    }
  }, [])
  return today
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

export function App() {
  const loops = useLiveQuery(() => allLoops(), [])
  const today = useToday()
  const settings = useLiveQuery(() => getSettings(), []) ?? DEFAULT_SETTINGS
  const meetingMinutes = useLiveQuery(() => getMeetingMinutes(today), [today]) ?? 0
  const [editing, setEditing] = useState<Editing | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  const groups = useMemo(() => groupLoops(loops ?? []), [loops])
  const projects = useMemo(() => projectsOf(loops ?? []), [loops])
  const load = useMemo(
    () => computeDayLoad(loops ?? [], today, settings, meetingMinutes),
    [loops, today, settings, meetingMinutes],
  )
  const openCount = groups.today.length + groups.week.length + groups.later.length
  const waitingCount = (loops ?? []).filter((l) => l.status === 'waiting').length

  // เปิดแอปหรือข้ามเที่ยงคืน: ยกงานที่ค้างเข้าวันนี้
  useEffect(() => {
    void rollOverDay(today)
  }, [today])

  const openCapture = useCallback((horizon: Horizon = 'week') => {
    setEditing({ mode: 'create', draft: emptyDraft(horizon) })
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (editing && !dialog.open) {
      dialog.showModal()
      // showModal จะ focus ปุ่มแรก (ปุ่มปิด) เอง ต้องย้ายมาที่ช่องชื่องาน ให้กด N แล้วพิมพ์ต่อได้ทันที
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    }
    if (!editing && dialog.open) dialog.close()
  }, [editing])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'n' || e.ctrlKey || e.metaKey || e.altKey) return
      if (isTyping(e.target) || dialogRef.current?.open) return
      e.preventDefault()
      openCapture()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openCapture])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 6000)
    return () => window.clearTimeout(timer)
  }, [toast])

  async function handleSave(draft: LoopDraft) {
    const now = new Date()
    const loop = editing?.mode === 'edit' ? applyDraft(editing.loop, draft, now) : createLoop(draft, now)
    await saveLoop(loop)
    setEditing(null)
  }

  async function handleChange(next: Loop, prev: Loop) {
    await saveLoop(next)
    if (isClosed(next) && !isClosed(prev)) {
      setToast({ message: `${next.status === 'done' ? 'ปิดลูป' : 'ทิ้ง'} "${next.title}" แล้ว`, undo: [prev] })
    }
  }

  async function postpone(targets: Loop[]) {
    const now = new Date()
    await saveLoops(targets.map((l) => postponeToTomorrow(l, now)))
    const what = targets.length === 1 ? `"${targets[0].title}"` : `${targets.length} งาน`
    setToast({ message: `เลื่อน ${what} ไปพรุ่งนี้แล้ว`, undo: targets })
  }

  async function undo() {
    if (!toast) return
    await saveLoops(toast.undo)
    setToast(null)
  }

  const sectionProps = {
    today,
    onChange: handleChange,
    onEdit: (loop: Loop) => setEditing({ mode: 'edit', loop }),
    onPostpone: (loop: Loop) => postpone([loop]),
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <Logo />
          <div>
            <h1>OpenLoops</h1>
            <p className="muted">{formatLongDay(today)}</p>
          </div>
        </div>
        <button type="button" className="primary capture-btn" onClick={() => openCapture()}>
          <Icon name="plus" /> จดงาน <kbd>N</kbd>
        </button>
      </header>

      {loops && loops.length > 0 && (
        <p className="summary">
          ลูปที่ยังเปิดอยู่ <strong>{openCount}</strong>
          {waitingCount > 0 && <> · รอคนอื่น {waitingCount}</>}
          {groups.closed.length > 0 && <> · ปิดแล้ว {groups.closed.length}</>}
        </p>
      )}

      {loops && loops.length > 0 && (
        <TodayPanel
          load={load}
          today={today}
          settings={settings}
          hasTodayLoops={groups.today.length > 0}
          onMeetingChange={(minutes) => void saveMeetingMinutes(today, minutes)}
          onSettingsChange={(next) => void saveSettings(next)}
          onPostpone={postpone}
        />
      )}

      {loops && loops.length === 0 && (
        <section className="empty">
          <h2>เริ่มจากจดงานแรกของคุณ</h2>
          <p>งานที่ยังไม่เสร็จทุกชิ้นจะอยู่ตรงนี้ จนกว่าคุณจะปิดมันเองอย่างตั้งใจ ไม่มีงานไหนหายไปเงียบ ๆ</p>
          <button type="button" className="primary" onClick={() => openCapture('today')}>
            <Icon name="plus" /> จดงาน
          </button>
        </section>
      )}

      {loops &&
        loops.length > 0 &&
        (['today', 'week', 'later'] as const).map((h) => (
          <section key={h} className="section" aria-labelledby={`sec-${h}`}>
            <div className="section-head">
              <h2 id={`sec-${h}`}>
                {HORIZON_LABEL[h]} <span className="count">{groups[h].length}</span>
              </h2>
              <button type="button" className="ghost" onClick={() => openCapture(h)} aria-label={`จดงานใน${HORIZON_LABEL[h]}`}>
                <Icon name="plus" />
              </button>
            </div>
            {groups[h].length ? (
              <div className="list">
                {groups[h].map((loop) => (
                  <LoopCard key={loop.id} loop={loop} {...sectionProps} />
                ))}
              </div>
            ) : (
              <p className="section-empty">ยังไม่มีงานในช่วงนี้</p>
            )}
          </section>
        ))}

      {groups.closed.length > 0 && (
        <details className="section closed">
          <summary>
            <h2>
              ปิดแล้ว <span className="count">{groups.closed.length}</span>
            </h2>
          </summary>
          <div className="list">
            {groups.closed.map((loop) => (
              <LoopCard key={loop.id} loop={loop} {...sectionProps} />
            ))}
          </div>
        </details>
      )}

      <dialog ref={dialogRef} className="sheet" onClose={() => setEditing(null)} aria-label="ฟอร์มจดงาน">
        {editing && (
          <CaptureForm
            key={editing.mode === 'edit' ? editing.loop.id : 'new'}
            mode={editing.mode}
            initial={editing.mode === 'edit' ? draftFromLoop(editing.loop) : editing.draft}
            projects={projects}
            today={today}
            onSave={handleSave}
            onCancel={() => setEditing(null)}
          />
        )}
      </dialog>

      {toast && (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          <button type="button" onClick={undo}>
            <Icon name="undo" /> เลิกทำ
          </button>
        </div>
      )}
    </div>
  )
}
