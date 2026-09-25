// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiAssist } from '../aiClient'
import { AiError } from '../domain/ai'
import { emptyDraft } from '../domain/loop'
import { CaptureForm } from './CaptureForm'

afterEach(cleanup)

function setup() {
  const onSave = vi.fn()
  render(
    <CaptureForm
      mode="create"
      initial={emptyDraft('week')}
      projects={['ลูกค้า ABC']}
      today="2026-09-24"
      onSave={onSave}
      onCancel={() => {}}
    />,
  )
  return { onSave, user: userEvent.setup() }
}

describe('CaptureForm', () => {
  it('shows an inline error and does not save when the title is empty', async () => {
    const { onSave, user } = setup()
    await user.click(screen.getByRole('button', { name: 'บันทึก' }))
    expect(screen.getByRole('alert').textContent).toBe('ใส่ชื่องานก่อน')
    expect(onSave).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('ชื่องาน'), 'ก')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('saves with only a title when Enter is pressed', async () => {
    const { onSave, user } = setup()
    await user.type(screen.getByLabelText('ชื่องาน'), 'ส่งรายงาน Q3{Enter}')
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toMatchObject({ title: 'ส่งรายงาน Q3', horizon: 'week', steps: [] })
  })

  it('collects choices from chips and steps without typing structure', async () => {
    const { onSave, user } = setup()
    await user.type(screen.getByLabelText('ชื่องาน'), 'ใบเสนอราคา')
    const group = (name: string) => within(screen.getByRole('radiogroup', { name }))
    await user.click(group('ทำเมื่อไหร่').getByRole('radio', { name: 'วันนี้' }))
    // วันพฤหัสบดี: "ศุกร์นี้" คือวันเดียวกับ "พรุ่งนี้" จึงแสดงแค่ปุ่มเดียว
    expect(group('กำหนดส่ง').queryByRole('radio', { name: 'ศุกร์นี้' })).toBeNull()
    await user.click(group('กำหนดส่ง').getByRole('radio', { name: 'จันทร์หน้า' }))
    await user.click(screen.getByRole('radio', { name: '2 ชม.' }))
    await user.click(screen.getByRole('radio', { name: 'ใช้สมาธิ' }))
    await user.click(screen.getByRole('radio', { name: 'ลูกค้า ABC' }))
    const stepInput = screen.getByLabelText(/ขั้นตอน/)
    await user.type(stepInput, 'ขอราคา{Enter}')
    await user.type(stepInput, 'ส่งลูกค้า')
    await user.click(screen.getByRole('button', { name: 'บันทึก' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const saved = onSave.mock.calls[0][0]
    expect(saved).toMatchObject({
      title: 'ใบเสนอราคา',
      horizon: 'today',
      dueDate: '2026-09-28',
      estimateMinutes: 120,
      energy: 'deep',
      project: 'ลูกค้า ABC',
    })
    // ขั้นที่พิมพ์ค้างไว้โดยไม่กด Enter ต้องไม่หาย
    expect(saved.steps.map((s: { title: string }) => s.title)).toEqual(['ขอราคา', 'ส่งลูกค้า'])
  })
})

function setupAi(ai: Partial<AiAssist>) {
  const onSave = vi.fn()
  const assist: AiAssist = { capture: vi.fn(), breakdown: vi.fn(), plan: vi.fn(), ...ai }
  render(
    <CaptureForm
      mode="create"
      initial={emptyDraft('week')}
      projects={['ลูกค้า ABC']}
      today="2026-09-24"
      onSave={onSave}
      onCancel={() => {}}
      ai={assist}
    />,
  )
  return { onSave, user: userEvent.setup() }
}

const titleInput = () => screen.getByLabelText('ชื่องาน') as HTMLInputElement
const checked = (group: string, name: string) =>
  within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name }).getAttribute('aria-checked')

describe('CaptureForm with the AI assistant', () => {
  it('shows no AI buttons until a key is set', () => {
    setup()
    expect(screen.queryByRole('button', { name: /AI/ })).toBeNull()
  })

  it('fills the form from a Thai sentence, lets the user check it, and can undo', async () => {
    const capture = vi.fn(async () => ({
      title: 'ส่งใบเสนอราคา',
      horizon: 'today' as const,
      dueDate: '2026-09-25',
      estimateMinutes: 90,
      energy: 'deep' as const,
      project: 'ลูกค้า ABC',
      steps: ['ขอราคา'],
    }))
    const { onSave, user } = setupAi({ capture })
    await user.type(titleInput(), 'พรุ่งนี้ส่งใบเสนอราคา ABC ใช้ชั่วโมงครึ่ง')
    await user.click(screen.getByRole('button', { name: /ให้ AI แยกรายละเอียด/ }))

    expect(capture).toHaveBeenCalledWith('พรุ่งนี้ส่งใบเสนอราคา ABC ใช้ชั่วโมงครึ่ง', expect.anything())
    expect(titleInput().value).toBe('ส่งใบเสนอราคา')
    expect(checked('ทำเมื่อไหร่', 'วันนี้')).toBe('true')
    expect(checked('กำหนดส่ง', 'พรุ่งนี้')).toBe('true')
    // 90 นาทีไม่มีปุ่ม จึงเพิ่มปุ่มให้เห็นค่าที่เลือก
    expect(checked('ใช้เวลาประมาณ', '1.5 ชม.')).toBe('true')
    const estimates = within(screen.getByRole('radiogroup', { name: 'ใช้เวลาประมาณ' })).getAllByRole('radio')
    expect(estimates.map((r) => r.textContent)).toEqual(['ไม่ระบุ', '15 นาที', '30 นาที', '1 ชม.', '1.5 ชม.', '2 ชม.', '4 ชม.'])
    expect(checked('ลักษณะงาน', 'ใช้สมาธิ')).toBe('true')
    expect(screen.getByRole('status').textContent).toContain('AI กรอกให้แล้ว')
    expect(onSave).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'ย้อนกลับ' }))
    expect(titleInput().value).toBe('พรุ่งนี้ส่งใบเสนอราคา ABC ใช้ชั่วโมงครึ่ง')
    expect(checked('ทำเมื่อไหร่', 'สัปดาห์นี้')).toBe('true')
  })

  it('shows a Thai error and keeps what was typed when the AI fails', async () => {
    const { user } = setupAi({ capture: vi.fn(async () => Promise.reject(new AiError('bad-key'))) })
    await user.type(titleInput(), 'ประโยค')
    await user.click(screen.getByRole('button', { name: /ให้ AI แยกรายละเอียด/ }))
    expect(screen.getByRole('alert').textContent).toContain('API key ใช้ไม่ได้')
    expect(titleInput().value).toBe('ประโยค')
  })

  it('suggests steps to tick and adds only the chosen ones', async () => {
    const breakdown = vi.fn(async () => ['ดึงตัวเลข', 'ทำกราฟ', 'เขียนสรุป'])
    const { onSave, user } = setupAi({ breakdown })
    await user.type(titleInput(), 'รายงาน Q3')
    await user.click(screen.getByRole('button', { name: /ให้ AI ช่วยแตกขั้น/ }))
    expect(breakdown).toHaveBeenCalledWith({ title: 'รายงาน Q3', project: null, estimateMinutes: null, steps: [] }, expect.anything())

    const group = within(screen.getByRole('group', { name: /ขั้นที่ AI เสนอ/ }))
    await user.click(group.getByRole('checkbox', { name: 'ทำกราฟ' }))
    await user.click(group.getByRole('button', { name: 'เพิ่ม 2 ขั้น' }))
    expect(screen.queryByRole('group', { name: /ขั้นที่ AI เสนอ/ })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'บันทึก' }))
    expect(onSave.mock.calls[0][0].steps.map((s: { title: string }) => s.title)).toEqual(['ดึงตัวเลข', 'เขียนสรุป'])
  })
})

