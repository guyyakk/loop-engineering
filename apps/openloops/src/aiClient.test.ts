import { afterEach, describe, expect, it, vi } from 'vitest'
import { callTool, makeAssist } from './aiClient'
import { AI_TIMEOUT_MS, MESSAGES_URL, breakdownRequest } from './domain/ai'

// Claude API จำลอง: ทดสอบการเรียกโดยไม่ใช้ key จริง

const creds = { apiKey: 'sk-ant-test-key-0000000000000000', model: 'claude-opus-5-5' }
const request = breakdownRequest({ title: 'ทำรายงาน', project: null, estimateMinutes: null, steps: [] })

const answer = (input: object) =>
  new Response(JSON.stringify({ content: [{ type: 'tool_use', id: 't1', name: 'suggest_steps', input }], stop_reason: 'tool_use' }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('callTool', () => {
  it('posts to the Messages API with the key, version and browser-access headers', async () => {
    const fetchMock = vi.fn(async () => answer({ steps: ['ดึงตัวเลข'] }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await callTool(creds, request)).toEqual({ steps: ['ดึงตัวเลข'] })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(MESSAGES_URL)
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      'x-api-key': creds.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    })
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ model: 'claude-opus-5-5', tool_choice: { type: 'tool', name: 'suggest_steps' } })
  })

  it('turns every failure into an AiError kind', async () => {
    const cases: [number, object, string][] = [
      [401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'bad-key'],
      [404, { error: { type: 'not_found_error', message: 'model' } }, 'model'],
      [429, { error: { type: 'rate_limit_error', message: 'slow down' } }, 'rate-limit'],
      [400, { error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } }, 'credit'],
      [529, { error: { type: 'overloaded_error', message: 'Overloaded' } }, 'overloaded'],
    ]
    for (const [status, body, kind] of cases) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
      await expect(callTool(creds, request)).rejects.toMatchObject({ kind })
    }
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(callTool(creds, request)).rejects.toMatchObject({ kind: 'network' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json')))
    await expect(callTool(creds, request)).rejects.toMatchObject({ kind: 'bad-output' })
  })

  it('can be cancelled, and gives up after a minute', async () => {
    const hanging = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    )
    vi.stubGlobal('fetch', hanging)
    const controller = new AbortController()
    const pending = callTool(creds, request, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' })

    vi.useFakeTimers()
    const slow = callTool(creds, request)
    const check = expect(slow).rejects.toMatchObject({ kind: 'timeout' })
    await vi.advanceTimersByTimeAsync(AI_TIMEOUT_MS)
    await check
  })
})

describe('makeAssist', () => {
  it('validates what comes back before the screen sees it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer({ steps: ['ร่างหัวข้อ', 'เขียนบทนำ'] })))
    const ai = makeAssist(creds, { today: '2026-09-25', workdays: [1, 2, 3, 4, 5], projects: [] })
    const steps = await ai.breakdown({ title: 'ทำคู่มือ', project: null, estimateMinutes: null, steps: ['ร่างหัวข้อ'] }, new AbortController().signal)
    expect(steps).toEqual(['เขียนบทนำ'])
  })
})
