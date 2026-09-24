import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { CaptureForm } from './components/CaptureForm'
import { Icon, Logo } from './components/Icon'
import { LoopCard } from './components/LoopCard'
import { ShutdownWizard, type RitualResult } from './components/ShutdownWizard'
import { Attention } from './components/Attention'
import { TodayPanel } from './components/TodayPanel'
import { WeekBoard } from './components/WeekBoard'
import { WeeklyReview } from './components/WeeklyReview'
import {
  allLoops,
  claimNotification,
  commitRitual,
  getDays,
  getMeetingMinutes,
  getMeetings,
  getSent,
  getSettings,
  rollOverDay,
  saveLoop,
  saveLoops,
  saveMeetingMinutes,
  saveSettings,
  undoRitual,
  type DayPlan,
} from './db'
import { DEFAULT_SETTINGS, buildWeek, computeDayLoad, type Particle } from './domain/capacity'
import { addDays, formatLongDay, nextWorkday, startOfWeek, toDateKey, withDay } from './domain/dates'
import {
  HORIZON_LABEL,
  applyDraft,
  applyPlan,
  createLoop,
  draftFromLoop,
  emptyDraft,
  groupLoops,
  isClosed,
  planValueOf,
  projectsOf,
  scheduleOn,
  type Horizon,
  type Loop,
  type LoopDraft,
  type PlanValue,
} from './domain/loop'
import { briefMessage, nudgesFor, pendingNotifications, shutdownMessage } from './domain/nudges'
import { reviewDue } from './domain/rituals'
import { permissionState, showNotification } from './notifier'

type Editing = { mode: 'create'; draft: LoopDraft } | { mode: 'edit'; loop: Loop }
/** undo เก็บสภาพก่อนเปลี่ยนของทุกลูปที่ถูกแก้ในครั้งนั้น และข้อมูลของวันถ้าเป็นพิธีปิดวัน/ทบทวน */
type Toast = { message: string; undo: Loop[]; day?: { date: string; before: DayPlan | undefined } }
type View = 'today' | 'week' | 'shutdown' | 'review'

const VIEWS: Record<string, View> = { '#week': 'week', '#shutdown': 'shutdown', '#review': 'review' }

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

/** มุมมองอยู่ใน URL (#week) กด back ได้และเปิดตรงจากลิงก์ได้ */
function useView(): View {
  const read = (): View => VIEWS[window.location.hash] ?? 'today'
  const [view, setView] = useState<View>(read)
  useEffect(() => {
    const onHash = () => setView(read())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return view
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

/** เปิด/ปิด <dialog> ตาม state และย้าย focus ไปช่องที่ควรพิมพ์ก่อน */
function useModal(ref: RefObject<HTMLDialogElement | null>, open: boolean) {
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      // showModal จะ focus ปุ่มแรก (ปุ่มปิด) เอง ต้องย้ายมาที่ช่องชื่องาน ให้กด N แล้วพิมพ์ต่อได้ทันที
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    }
    if (!open && dialog.open) dialog.close()
  }, [ref, open])
}

function planLabel(target: PlanValue, today: string): string {
  if (target === 'week') return 'สัปดาห์นี้ (ไม่ระบุวัน)'
  if (target === 'later') return 'ไว้ก่อน'
  return withDay('', target, today).trim()
}

export function App() {
  const loops = useLiveQuery(() => allLoops(), [])
  const today = useToday()
  const view = useView()
  const storedSettings = useLiveQuery(() => getSettings(), [])
  const settings = storedSettings ?? DEFAULT_SETTINGS
  const meetingMinutes = useLiveQuery(() => getMeetingMinutes(today), [today]) ?? 0
  const [weekOffset, setWeekOffset] = useState(0)
  const weekStart = addDays(startOfWeek(today), weekOffset * 7)
  const meetings = useLiveQuery(() => getMeetings(weekStart, addDays(weekStart, 6)), [weekStart])
  const thisWeek = startOfWeek(today)
  const weekRows = useLiveQuery(() => getDays(thisWeek, addDays(thisWeek, 6)), [thisWeek])
  const [editing, setEditing] = useState<Editing | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set())
  const [toast, setToast] = useState<Toast | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const detailRef = useRef<HTMLDialogElement>(null)

  const groups = useMemo(() => groupLoops(loops ?? [], today), [loops, today])
  const projects = useMemo(() => projectsOf(loops ?? []), [loops])
  const load = useMemo(
    () => computeDayLoad(loops ?? [], today, settings, meetingMinutes),
    [loops, today, settings, meetingMinutes],
  )
  const week = useMemo(
    () => buildWeek(loops ?? [], weekStart, today, settings, meetings ?? {}),
    [loops, weekStart, today, settings, meetings],
  )
  const nudges = useMemo(() => nudgesFor(loops ?? [], today, settings), [loops, today, settings])
  const postponeDate = nextWorkday(today, settings.workdays)
  const detail = detailId ? (loops ?? []).find((l) => l.id === detailId) ?? null : null
  const shutdownAt = weekRows?.find((d) => d.date === today)?.shutdownAt
  const shutdownDates = (weekRows ?? []).filter((d) => d.shutdownAt).map((d) => d.date)
  const showReviewPrompt = weekRows !== undefined && reviewDue(today, settings, (weekRows ?? []).filter((d) => d.reviewAt).map((d) => d.date))
  const openCount = groups.today.length + groups.week.length + groups.later.length
  const waitingCount = (loops ?? []).filter((l) => l.status === 'waiting').length

  // เปิดแอปหรือข้ามเที่ยงคืน: ยกงานที่ค้างเข้าวันนี้ รอให้โหลดวันทำงานจริงก่อน จะได้ไม่ยกผิดวัน
  const workdaysKey = storedSettings?.workdays.join(',')
  useEffect(() => {
    if (workdaysKey === undefined) return
    void rollOverDay(today, workdaysKey ? workdaysKey.split(',').map(Number) : [])
  }, [today, workdaysKey])

  // ค่าล่าสุดสำหรับตัวจับเวลาแจ้งเตือน จะได้ไม่ต้องตั้งเวลาใหม่ทุกครั้งที่ข้อมูลเปลี่ยน
  const latest = useRef({ settings, load, nudges, openToday: groups.today.length })
  latest.current = { settings, load, nudges, openToday: groups.today.length }
  const loopsReady = loops !== undefined
  const notifyOn = storedSettings?.notify === true

  useEffect(() => {
    if (!notifyOn || !loopsReady) return
    let stopped = false
    const tick = async () => {
      const now = new Date()
      const date = toDateKey(now)
      const due = pendingNotifications(now, latest.current.settings, await getSent(date))
      for (const kind of due) {
        if (stopped || permissionState() !== 'granted') return
        if (!(await claimNotification(date, kind))) continue
        const { load: dayLoad, nudges: dayNudges, openToday } = latest.current
        const message = kind === 'brief' ? briefMessage(dayLoad, dayNudges) : shutdownMessage(openToday)
        await showNotification(message, `openloops-${kind}-${date}`, kind === 'shutdown' ? '/#shutdown' : '/')
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 60_000)
    const onVisible = () => void tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [notifyOn, loopsReady])

  async function testNotification() {
    const shown = await showNotification(briefMessage(load, nudges), 'openloops-test', '/')
    setToast({ message: shown ? 'ส่งแจ้งเตือนทดสอบแล้ว' : 'ยังไม่ได้รับสิทธิ์แจ้งเตือนจาก browser', undo: [] })
  }

  useModal(dialogRef, editing !== null)
  useModal(detailRef, detail !== null)

  const openCapture = useCallback((horizon: Horizon = 'week') => {
    setEditing({ mode: 'create', draft: emptyDraft(horizon) })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'n' || e.ctrlKey || e.metaKey || e.altKey) return
      if (isTyping(e.target) || document.querySelector('dialog[open]')) return
      e.preventDefault()
      openCapture()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openCapture])

  useEffect(() => {
    if (!toast) return
    // หลังพิธีปิดวัน/ทบทวน ให้เวลาเลิกทำนานกว่าการแก้ทีละงาน
    const timer = window.setTimeout(() => setToast(null), toast.day ? 15_000 : 6000)
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
    await saveLoops(targets.map((l) => scheduleOn(l, postponeDate, now)))
    const what = targets.length === 1 ? `"${targets[0].title}"` : `${targets.length} งาน`
    setToast({ message: `เลื่อน ${what} ${withDay('ไป', postponeDate, today)}แล้ว`, undo: targets })
  }

  async function move(loop: Loop, target: PlanValue) {
    if (planValueOf(loop, today) === target) return
    if (target !== 'week' && target !== 'later' && target < today) return
    await saveLoop(applyPlan(loop, target, new Date()))
    setToast({ message: `ย้าย "${loop.title}" ไป${planLabel(target, today)}แล้ว`, undo: [loop] })
  }

  async function undo() {
    if (!toast) return
    if (toast.day) await undoRitual(toast.day.date, toast.undo, toast.day.before)
    else await saveLoops(toast.undo)
    setToast(null)
  }

  async function finishShutdown({ changed, previous, note }: RitualResult) {
    const before = await commitRitual(today, changed, { shutdownAt: new Date().toISOString(), ...(note ? { note } : {}) })
    setToast({ message: 'ปิดวันแล้ว เลิกงานได้เลย', undo: previous, day: { date: today, before } })
    window.location.hash = ''
  }

  async function finishReview({ changed, previous }: RitualResult) {
    const before = await commitRitual(today, changed, { reviewAt: new Date().toISOString() })
    setToast({ message: 'บันทึกการทบทวนสัปดาห์แล้ว', undo: previous, day: { date: today, before } })
    window.location.hash = 'week'
  }

  // กดแจ้งเตือนตอนแอปเปิดอยู่: service worker ส่ง hash มาให้เปิดหน้าที่ถูกต้อง
  useEffect(() => {
    const sw = navigator.serviceWorker
    if (!sw) return
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'openloops:navigate' && typeof e.data.hash === 'string') window.location.hash = e.data.hash
    }
    sw.addEventListener('message', onMessage)
    return () => sw.removeEventListener('message', onMessage)
  }, [])

  function toggleOpen(id: string) {
    setOpenIds((ids) => {
      const next = new Set(ids)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  const cardProps = {
    today,
    settings,
    onParticleChange: (particle: Particle) => void saveSettings({ ...settings, particle }),
    onChange: handleChange,
    onEdit: (loop: Loop) => {
      setDetailId(null)
      setEditing({ mode: 'edit', loop })
    },
    onPostpone: (loop: Loop) => postpone([loop]),
  }

  const renderCard = (loop: Loop) => (
    <LoopCard key={loop.id} loop={loop} {...cardProps} open={openIds.has(loop.id)} onToggle={() => toggleOpen(loop.id)} />
  )

  return (
    <div className={`app${view === 'week' ? ' wide' : ''}`}>
      <header className="top">
        <div className="brand">
          <Logo />
          <div>
            <h1>OpenLoops</h1>
            <p className="muted">{formatLongDay(today)}</p>
          </div>
        </div>
        <nav className="tabs" aria-label="มุมมอง">
          <a href="#" aria-current={view === 'today' ? 'page' : undefined}>
            วันนี้
          </a>
          <a href="#week" aria-current={view === 'week' ? 'page' : undefined}>
            สัปดาห์
          </a>
        </nav>
        <button type="button" className="primary capture-btn" onClick={() => openCapture()}>
          <Icon name="plus" /> จดงาน <kbd>N</kbd>
        </button>
      </header>

      {loops && loops.length === 0 && (
        <section className="empty">
          <h2>เริ่มจากจดงานแรกของคุณ</h2>
          <p>งานที่ยังไม่เสร็จทุกชิ้นจะอยู่ตรงนี้ จนกว่าคุณจะปิดมันเองอย่างตั้งใจ ไม่มีงานไหนหายไปเงียบ ๆ</p>
          <button type="button" className="primary" onClick={() => openCapture('today')}>
            <Icon name="plus" /> จดงาน
          </button>
        </section>
      )}

      {loops && view === 'shutdown' && (
        <ShutdownWizard
          loops={loops}
          today={today}
          settings={settings}
          onLoopChange={(next) => void saveLoop(next)}
          onFinish={(result) => void finishShutdown(result)}
          onCancel={() => (window.location.hash = '')}
        />
      )}

      {loops && weekRows && view === 'review' && (
        <WeeklyReview
          loops={loops}
          today={today}
          settings={settings}
          shutdownDates={shutdownDates}
          onFinish={(result) => void finishReview(result)}
          onCancel={() => (window.location.hash = 'week')}
        />
      )}

      {loops && loops.length > 0 && view === 'week' && (
        <WeekBoard
          plan={week}
          today={today}
          settings={settings}
          weekStart={weekStart}
          weekOffset={weekOffset}
          onWeekOffset={setWeekOffset}
          onOpen={(loop) => setDetailId(loop.id)}
          onMove={move}
          onMeetingChange={(date, minutes) => void saveMeetingMinutes(date, minutes)}
          onReview={() => (window.location.hash = 'review')}
        />
      )}

      {loops && loops.length > 0 && view === 'today' && (
        <>
          <p className="summary">
            ลูปที่ยังเปิดอยู่ <strong>{openCount}</strong>
            {waitingCount > 0 && <> · รอคนอื่น {waitingCount}</>}
            {groups.closed.length > 0 && <> · ปิดแล้ว {groups.closed.length}</>}
          </p>

          {showReviewPrompt && (
            <div className="ritual-prompt">
              <span>
                <strong>ถึงเวลาทบทวนสัปดาห์</strong> เคลียร์งานค้างและวางแผนสัปดาห์หน้า ใช้เวลาราว 15 นาที
              </span>
              <a className="button" href="#review">
                เริ่มทบทวน
              </a>
            </div>
          )}

          <Attention nudges={nudges} onPull={(loop) => void move(loop, today)} onOpen={(loop) => setDetailId(loop.id)} />

          <TodayPanel
            load={load}
            today={today}
            settings={settings}
            hasTodayLoops={groups.today.length > 0}
            postponeDate={postponeDate}
            shutdownAt={shutdownAt}
            onMeetingChange={(minutes) => void saveMeetingMinutes(today, minutes)}
            onSettingsChange={(next) => void saveSettings(next)}
            onPostpone={postpone}
            onTestNotification={() => void testNotification()}
          />

          {(['today', 'week', 'later'] as const).map((h) => (
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
                <div className="list">{groups[h].map(renderCard)}</div>
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
              <div className="list">{groups.closed.map(renderCard)}</div>
            </details>
          )}
        </>
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

      <dialog ref={detailRef} className="sheet detail" onClose={() => setDetailId(null)} aria-label="รายละเอียดงาน">
        {detail && (
          <div className="detail-body">
            <div className="capture-head">
              <h2>รายละเอียดงาน</h2>
              <button type="button" className="icon-btn" onClick={() => setDetailId(null)} aria-label="ปิด">
                <Icon name="x" size={18} />
              </button>
            </div>
            <LoopCard loop={detail} {...cardProps} open onToggle={() => setDetailId(null)} />
          </div>
        )}
      </dialog>

      {toast && (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {(toast.undo.length > 0 || toast.day) && (
            <button type="button" onClick={undo}>
              <Icon name="undo" /> เลิกทำ
            </button>
          )}
        </div>
      )}
    </div>
  )
}
