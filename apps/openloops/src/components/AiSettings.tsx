import { useId, useState } from 'react'
import { AI_MODELS, maskKey, validateApiKey, type AiConfig } from '../domain/ai'
import { Chips } from './Chips'

interface Props {
  config: AiConfig
  onChange: (config: AiConfig) => void
}

/** ตั้งค่าผู้ช่วย AI: key ของผู้ใช้เอง เก็บเฉพาะเครื่องนี้ */
export function AiSettings({ config, onChange }: Props) {
  const ids = useId()
  const [editing, setEditing] = useState(false)
  // ยังไม่มี key (หรือเพิ่งลบ) ให้แสดงช่องใส่ key เสมอ
  const showForm = editing || !config.apiKey
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  // รุ่นที่เก็บไว้อาจไม่อยู่ในรายการแล้ว ให้ยังเห็นว่าเลือกอะไรอยู่
  const models = AI_MODELS.some((m) => m.id === config.model)
    ? AI_MODELS
    : [...AI_MODELS, { id: config.model, label: config.model, note: '' }]

  function saveKey() {
    const found = validateApiKey(draft)
    setError(found)
    if (found) return
    onChange({ ...config, apiKey: draft.trim() })
    setDraft('')
    setEditing(false)
  }

  return (
    <div className="field ai-settings">
      <span className="field-label">
        ผู้ช่วย AI <span className="muted">จดงานจากประโยค แตกงานเป็นขั้น และจัดแผนเช้า ด้วย Claude</span>
      </span>
      <p className="field-note" role="status">
        {config.apiKey
          ? `พร้อมใช้ · key ${maskKey(config.apiKey)} เก็บเฉพาะในเครื่องนี้ ไม่อยู่ในไฟล์สำรอง`
          : 'ยังไม่ได้ใส่ API key ปุ่ม AI จะยังไม่แสดง แอปใช้งานได้ตามปกติ'}
      </p>

      {showForm ? (
        <>
          <div className="inline-add">
            <label className="sr-only" htmlFor={`${ids}-key`}>
              Claude API key
            </label>
            <input
              id={`${ids}-key`}
              type="password"
              placeholder="sk-ant-..."
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                setError(null)
              }}
              aria-invalid={!!error}
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" onClick={saveKey}>
              บันทึก
            </button>
            {config.apiKey && (
              <button type="button" className="ghost" onClick={() => setEditing(false)}>
                ยกเลิก
              </button>
            )}
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <p className="field-note">
            สร้าง key ได้ที่{' '}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">
              Claude Console
            </a>{' '}
            คิดค่าใช้จ่ายตามการใช้งานจริง ควรตั้งวงเงินใช้จ่ายไว้ในหน้า Billing
          </p>
        </>
      ) : (
        <div className="notify-row">
          <button type="button" className="chip" onClick={() => setEditing(true)}>
            เปลี่ยน key
          </button>
          <button type="button" className="chip" onClick={() => onChange({ ...config, apiKey: null })}>
            ลบ key ออกจากเครื่องนี้
          </button>
        </div>
      )}

      <Chips
        label="รุ่นของ AI"
        options={models.map((m) => ({ value: m.id, label: m.note ? `${m.label} · ${m.note}` : m.label }))}
        value={config.model}
        onChange={(model) => onChange({ ...config, model })}
      />
      <p className="field-note">
        แอปส่งข้อมูลไปที่ Anthropic เฉพาะตอนที่คุณกดปุ่ม AI: ประโยคที่พิมพ์, ชื่องานกับขั้นของงานนั้น หรือรายการงานที่เปิดอยู่ตอนขอแผนเช้า
      </p>
    </div>
  )
}
