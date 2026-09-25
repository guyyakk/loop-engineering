// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AI_CONFIG, type AiConfig } from '../domain/ai'
import { AiSettings } from './AiSettings'

afterEach(cleanup)

const KEY = 'sk-ant-api03-test0000000000000000000000'

function setup(config: AiConfig) {
  const onChange = vi.fn()
  const view = render(<AiSettings config={config} onChange={onChange} />)
  return { onChange, view, user: userEvent.setup() }
}

describe('AiSettings', () => {
  it('rejects keys that are not Claude keys and saves a valid one trimmed', async () => {
    const { onChange, user } = setup(DEFAULT_AI_CONFIG)
    const input = screen.getByLabelText('Claude API key') as HTMLInputElement
    expect(input.type).toBe('password')
    await user.type(input, 'sk-proj-123')
    await user.click(screen.getByRole('button', { name: 'บันทึก' }))
    expect(screen.getByRole('alert').textContent).toContain('ขึ้นต้นด้วย sk-ant-')
    expect(onChange).not.toHaveBeenCalled()

    await user.clear(input)
    await user.type(input, `  ${KEY} `)
    await user.click(screen.getByRole('button', { name: 'บันทึก' }))
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_AI_CONFIG, apiKey: KEY })
  })

  it('never shows the full key, and asks for a key again after it is removed', async () => {
    const { onChange, view, user } = setup({ ...DEFAULT_AI_CONFIG, apiKey: KEY })
    expect(document.body.textContent).not.toContain(KEY)
    expect(screen.getByRole('status').textContent).toContain('sk-ant-…0000')
    expect(screen.queryByLabelText('Claude API key')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'ลบ key ออกจากเครื่องนี้' }))
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_AI_CONFIG, apiKey: null })
    view.rerender(<AiSettings config={DEFAULT_AI_CONFIG} onChange={onChange} />)
    expect(screen.getByLabelText('Claude API key')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'ลบ key ออกจากเครื่องนี้' })).toBeNull()
  })
})
