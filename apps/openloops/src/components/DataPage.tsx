import { useEffect, useId, useState, type ChangeEvent } from 'react'
import { MAX_BACKUP_BYTES, backupAgeDays, mergeBackup, parseBackup, type Backup, type ParseResult } from '../domain/backup'
import { dateKeyOf, formatLongDay, withDay, type DateKey } from '../domain/dates'
import { isClosed, type Loop } from '../domain/loop'
import { requestPersistentStorage } from '../db'
import { Chips, type ChipOption } from './Chips'
import { Icon } from './Icon'

export type ImportMode = 'merge' | 'replace'

interface Props {
  loops: Loop[]
  today: DateKey
  lastBackupAt: string | null
  onExport: () => void
  onImport: (backup: Backup, mode: ImportMode) => void
  onClose: () => void
}

type Picked = { name: string; result: ParseResult }

const MODES: ChipOption<ImportMode>[] = [
  { value: 'merge', label: 'รวมกับข้อมูลเดิม' },
  { value: 'replace', label: 'แทนที่ทั้งหมด' },
]

const exportedText = (iso: string, today: DateKey) => {
  const d = new Date(iso)
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${withDay('', dateKeyOf(iso), today).trim()} ${time}`
}

/** หน้าข้อมูลและการสำรอง: ส่งออก นำเข้า และบอกความเสี่ยงของการเก็บข้อมูลใน browser */
export function DataPage({ loops, today, lastBackupAt, onExport, onImport, onClose }: Props) {
  const ids = useId()
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [mode, setMode] = useState<ImportMode>('merge')
  const [confirmReplace, setConfirmReplace] = useState(false)
  const closed = loops.filter(isClosed).length
  const age = backupAgeDays(lastBackupAt, today)

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted, () => setPersisted(false))
  }, [])

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    setConfirmReplace(false)
    setMode('merge')
    if (!file) return
    if (file.size > MAX_BACKUP_BYTES) {
      setPicked({ name: file.name, result: { ok: false, error: 'ไฟล์ใหญ่เกิน 10 MB ไม่น่าใช่ไฟล์สำรองของ OpenLoops' } })
      return
    }
    setPicked({ name: file.name, result: parseBackup(await file.text()) })
  }

  async function askPersist() {
    setPersisted(await requestPersistentStorage())
  }

  const ok = picked?.result.ok ? picked.result : null
  const merge = ok ? mergeBackup({ loops, days: [] }, ok.backup) : null

  function runImport() {
    if (!ok) return
    if (mode === 'replace' && !confirmReplace) {
      setConfirmReplace(true)
      return
    }
    onImport(ok.backup, mode)
  }

  return (
    <section className="data-page" aria-labelledby={`${ids}-h`}>
      <header className="ritual-head">
        <div>
          <p className="ritual-kicker">ตั้งค่า</p>
          <h2 id={`${ids}-h`}>ข้อมูลและการสำรอง</h2>
        </div>
        <button type="button" className="ghost" onClick={onClose}>
          <Icon name="x" /> ปิด
        </button>
      </header>

      <p className="ritual-lead">
        งานทั้งหมดเก็บอยู่ใน browser บนเครื่องนี้ที่เดียว ไม่มี server ถ้า browser ล้างข้อมูล หรือจะย้ายไปเครื่องอื่น ให้ใช้ไฟล์สำรอง
      </p>

      <div className="metrics">
        <div className="metric">
          <span className="metric-label">งานในเครื่องนี้</span>
          <span className="metric-value">{loops.length} งาน</span>
          <span className="field-note">
            เปิดอยู่ {loops.length - closed} · ปิดแล้ว {closed}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">สำรองล่าสุด</span>
          <span className={`metric-value ${age === null || age >= 7 ? 'warn' : ''}`}>
            {lastBackupAt ? exportedText(lastBackupAt, today) : 'ยังไม่เคย'}
          </span>
        </div>
      </div>

      <p className="field-note" role="status">
        {persisted === null
          ? 'กำลังตรวจว่า browser เก็บข้อมูลแบบถาวรหรือไม่'
          : persisted
            ? 'browser ตั้งให้เก็บข้อมูลของแอปนี้แบบถาวรแล้ว แต่ถ้าผู้ใช้ล้างข้อมูลเว็บเองก็ยังหายได้'
            : 'browser ยังไม่ได้เก็บข้อมูลแบบถาวร อาจลบเองเมื่อพื้นที่เหลือน้อยหรือเมื่อล้างประวัติ'}
        {persisted === false && (
          <>
            {' '}
            <button type="button" className="link-btn" onClick={askPersist}>
              ขอให้เก็บถาวร
            </button>
          </>
        )}
      </p>

      <div className="data-block">
        <h3>ส่งออก</h3>
        <p className="field-note">ได้ไฟล์ .json หนึ่งไฟล์ มีงานทุกชิ้นรวมที่ปิดแล้ว ข้อมูลรายวัน และการตั้งค่า เก็บไว้ใน Drive หรือ OneDrive ได้</p>
        <div>
          <button type="button" className="primary" onClick={onExport}>
            <Icon name="download" /> ดาวน์โหลดไฟล์สำรอง
          </button>
        </div>
      </div>

      <div className="data-block">
        <h3>นำเข้าจากไฟล์</h3>
        <p className="field-note">ตรวจไฟล์ทั้งหมดก่อน ถ้าผิดตรงไหนจะไม่แตะข้อมูลเดิม และนำเข้าแล้วยังกดเลิกทำได้</p>
        <label className="button file-pick">
          <Icon name="folder" /> เลือกไฟล์สำรอง
          <input type="file" accept=".json,application/json" className="sr-only" onChange={pick} />
        </label>

        {picked && !picked.result.ok && (
          <p className="field-error" role="alert">
            {picked.name}: {picked.result.error}
          </p>
        )}

        {ok && merge && (
          <div className="import-preview">
            <p>
              <strong>{picked!.name}</strong>
              <br />
              สำรองเมื่อ {formatLongDay(dateKeyOf(ok.summary.exportedAt))} · {ok.summary.loops} งาน (เปิด {ok.summary.open} · ปิดแล้ว{' '}
              {ok.summary.closed}) · ข้อมูลรายวัน {ok.summary.days} วัน
            </p>
            <Chips
              label="วิธีนำเข้า"
              options={MODES}
              value={mode}
              onChange={(m) => {
                setMode(m)
                setConfirmReplace(false)
              }}
            />
            {mode === 'merge' ? (
              <p className="field-note">
                จะเพิ่มงานใหม่ {merge.added} งาน · อัปเดต {merge.updated} งานที่ในไฟล์แก้ล่าสุดกว่า · คงของเดิมไว้ {merge.kept} งาน · การตั้งค่าคงเดิม
              </p>
            ) : (
              <p className="field-error">
                ข้อมูลในเครื่องนี้ {loops.length} งาน และการตั้งค่า จะถูกแทนที่ด้วยข้อมูลในไฟล์ {ok.summary.loops} งาน
              </p>
            )}
            <div className="row-end">
              <button type="button" onClick={() => setPicked(null)}>
                ยกเลิก
              </button>
              <button type="button" className="primary" onClick={runImport}>
                {mode === 'merge' ? 'นำเข้า' : confirmReplace ? 'ยืนยัน แทนที่ทั้งหมด' : 'แทนที่ทั้งหมด'}
              </button>
            </div>
            {confirmReplace && <p className="field-note">กดอีกครั้งเพื่อยืนยัน หลังแทนที่ยังกดเลิกทำได้ 15 วินาที</p>}
          </div>
        )}
      </div>
    </section>
  )
}
