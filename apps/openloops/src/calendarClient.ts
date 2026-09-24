import {
  CalendarError,
  FREEBUSY_SCOPE,
  FREEBUSY_URL,
  errorFromStatus,
  freeBusyBody,
  parseFreeBusy,
  type BusyInterval,
  type CalendarToken,
} from './domain/calendar'
import type { DateKey } from './domain/dates'

// เชื่อม Google Calendar ผ่าน Google Identity Services (token model) จาก browser ตรง ไม่มี server
// token อยู่ในหน่วยความจำของหน้านี้เท่านั้น ปิดแอปแล้วหายไป ไม่บันทึกลงดิสก์และไม่ log

const GIS_URL = 'https://accounts.google.com/gsi/client'

interface TokenResponse {
  access_token?: string
  expires_in?: number | string
  error?: string
}

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void
}

interface GoogleOAuth2 {
  initTokenClient: (config: {
    client_id: string
    scope: string
    callback: (response: TokenResponse) => void
    error_callback?: (error: { type?: string }) => void
  }) => TokenClient
  hasGrantedAllScopes?: (response: TokenResponse, ...scopes: string[]) => boolean
  revoke: (token: string, done?: () => void) => void
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } }
  }
}

let token: CalendarToken | null = null
let loading: Promise<void> | null = null
let client: { clientId: string; tokenClient: TokenClient } | null = null
let pending: { resolve: (t: CalendarToken) => void; reject: (e: CalendarError) => void } | null = null

const oauth2 = () => window.google?.accounts?.oauth2

export function currentToken(): CalendarToken | null {
  return token
}

/** โหลดสคริปต์ของ Google ล่วงหน้า เพื่อให้กดเชื่อมต่อแล้วเปิดหน้าต่างขอสิทธิ์ได้ทันทีในจังหวะที่ผู้ใช้กด */
export function loadGis(): Promise<void> {
  if (oauth2()) return Promise.resolve()
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_URL
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      loading = null
      reject(new CalendarError('network'))
    }
    document.head.appendChild(script)
  })
  return loading
}

export function gisReady(): boolean {
  return !!oauth2()
}

function tokenClientFor(clientId: string): TokenClient {
  const api = oauth2()
  if (!api) throw new CalendarError('not-loaded')
  if (client?.clientId === clientId) return client.tokenClient
  const tokenClient = api.initTokenClient({
    client_id: clientId,
    scope: FREEBUSY_SCOPE,
    callback: (response) => {
      const done = pending
      pending = null
      if (!done) return
      if (response.error || !response.access_token) {
        done.reject(new CalendarError(response.error === 'access_denied' ? 'access-denied' : 'bad-client'))
        return
      }
      // ผู้ใช้เลือกไม่ติ๊กสิทธิ์ได้ ถ้าไม่ได้สิทธิ์ดูช่วงว่าง ถือว่าไม่อนุญาต
      if (api.hasGrantedAllScopes && !api.hasGrantedAllScopes(response, FREEBUSY_SCOPE)) {
        done.reject(new CalendarError('access-denied'))
        return
      }
      token = { accessToken: response.access_token, expiresAt: Date.now() + Number(response.expires_in ?? 3600) * 1000 }
      done.resolve(token)
    },
    error_callback: (error) => {
      const done = pending
      pending = null
      done?.reject(new CalendarError(error?.type === 'popup_closed' ? 'popup-closed' : 'bad-client'))
    },
  })
  client = { clientId, tokenClient }
  return tokenClient
}

/**
 * ขอ token ต้องเรียกตรงจากการกดของผู้ใช้ เพราะ Google เปิดเป็นหน้าต่าง popup
 * prompt 'consent' ครั้งแรก, '' เมื่อเคยอนุญาตแล้ว (หน้าต่างจะปิดเองเร็ว ๆ)
 */
export function requestToken(clientId: string, prompt: 'consent' | ''): Promise<CalendarToken> {
  const tokenClient = tokenClientFor(clientId)
  pending?.reject(new CalendarError('popup-closed'))
  return new Promise<CalendarToken>((resolve, reject) => {
    pending = { resolve, reject }
    tokenClient.requestAccessToken({ prompt })
  })
}

export async function fetchBusy(today: DateKey, current: CalendarToken): Promise<BusyInterval[]> {
  let response: Response
  try {
    response = await fetch(FREEBUSY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${current.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(freeBusyBody(today)),
    })
  } catch {
    throw new CalendarError('network')
  }
  if (!response.ok) {
    if (response.status === 401) token = null
    throw new CalendarError(errorFromStatus(response.status))
  }
  return parseFreeBusy(await response.json())
}

/** เพิกถอนสิทธิ์ที่ Google และลืม token */
export function disconnect(): void {
  const current = token
  token = null
  if (current) oauth2()?.revoke(current.accessToken)
}
