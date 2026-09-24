// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
