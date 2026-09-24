// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FREEBUSY_SCOPE, FREEBUSY_URL } from './domain/calendar'

// Google Identity Services และ Calendar API จำลอง: ทดสอบการทำงานของแอปโดยไม่ต้องล็อกอิน Google จริง

type Config = { client_id: string; scope: string; callback: (r: object) => void; error_callback?: (e: object) => void }

function fakeGoogle(behaviour: 'grant' | 'deny' | 'close' | 'no-scope') {
  const calls = { init: [] as Config[], prompts: [] as (string | undefined)[], revoked: [] as string[] }
  window.google = {
    accounts: {
      oauth2: {
        initTokenClient: (config: Config) => {
          calls.init.push(config)
          return {
            requestAccessToken: (o?: { prompt?: string }) => {
              calls.prompts.push(o?.prompt)
              queueMicrotask(() => {
                if (behaviour === 'grant' || behaviour === 'no-scope') config.callback({ access_token: 'tok-1', expires_in: 3599 })
                if (behaviour === 'deny') config.callback({ error: 'access_denied' })
                if (behaviour === 'close') config.error_callback?.({ type: 'popup_closed' })
              })
            },
          }
        },
        hasGrantedAllScopes: () => behaviour !== 'no-scope',
        revoke: (t: string) => calls.revoked.push(t),
      },
    },
  }
  return calls
}

// โมดูลเก็บ token ไว้ในหน่วยความจำ จึงโหลดใหม่ทุกเทสต์
async function client() {
  vi.resetModules()
  return import('./calendarClient')
}

beforeEach(() => {
  delete window.google
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('calendar client', () => {
  it('asks only for the free/busy scope and keeps the token in memory', async () => {
    const calls = fakeGoogle('grant')
    const c = await client()
    const token = await c.requestToken('123-abc.apps.googleusercontent.com', 'consent')
    expect(calls.init[0]).toMatchObject({ client_id: '123-abc.apps.googleusercontent.com', scope: FREEBUSY_SCOPE })
    expect(calls.prompts).toEqual(['consent'])
    expect(token.accessToken).toBe('tok-1')
    expect(token.expiresAt).toBeGreaterThan(Date.now() + 3500_000)
    expect(c.currentToken()).toEqual(token)
    expect(JSON.stringify(localStorage)).not.toContain('tok-1')
  })

  it('maps a denied consent, an unticked scope and a closed popup to clear errors', async () => {
    fakeGoogle('deny')
    await expect((await client()).requestToken('1-a.apps.googleusercontent.com', 'consent')).rejects.toMatchObject({ kind: 'access-denied' })
    fakeGoogle('no-scope')
    await expect((await client()).requestToken('1-a.apps.googleusercontent.com', 'consent')).rejects.toMatchObject({ kind: 'access-denied' })
    fakeGoogle('close')
    await expect((await client()).requestToken('1-a.apps.googleusercontent.com', '')).rejects.toMatchObject({ kind: 'popup-closed' })
  })

  it('fails fast when the Google script is not loaded yet', async () => {
    const c = await client()
    let kind: string | null = null
    try {
      void c.requestToken('1-a.apps.googleusercontent.com', 'consent')
    } catch (e) {
      kind = (e as { kind: string }).kind
    }
    expect(kind).toBe('not-loaded')
  })

  it('queries freeBusy with the bearer token and handles expiry', async () => {
    fakeGoogle('grant')
    const c = await client()
    const token = await c.requestToken('1-a.apps.googleusercontent.com', 'consent')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ calendars: { primary: { busy: [{ start: 's', end: 'e' }] } } })))
    vi.stubGlobal('fetch', fetchMock)
    expect(await c.fetchBusy('2026-09-24', token)).toEqual([{ start: 's', end: 'e' }])
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(FREEBUSY_URL)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1')
    expect(JSON.parse(init.body as string).items).toEqual([{ id: 'primary' }])

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    await expect(c.fetchBusy('2026-09-24', token)).rejects.toMatchObject({ kind: 'expired' })
    expect(c.currentToken()).toBeNull()

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))
    await expect(c.fetchBusy('2026-09-24', token)).rejects.toMatchObject({ kind: 'network' })
  })

  it('revokes the token on disconnect', async () => {
    const calls = fakeGoogle('grant')
    const c = await client()
    await c.requestToken('1-a.apps.googleusercontent.com', 'consent')
    c.disconnect()
    expect(calls.revoked).toEqual(['tok-1'])
    expect(c.currentToken()).toBeNull()
  })
})
