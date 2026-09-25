import {
  AI_TIMEOUT_MS,
  API_VERSION,
  AiError,
  MESSAGES_URL,
  breakdownRequest,
  captureRequest,
  errorFromResponse,
  messagesBody,
  parseBreakdown,
  parseCapture,
  parsePlan,
  planRequest,
  toolInput,
  type AiPlan,
  type AiRequest,
  type BreakdownInput,
  type CaptureContext,
  type CaptureSuggestion,
  type PlanContext,
} from './domain/ai'
import type { Loop } from './domain/loop'

// เรียก Claude Messages API จาก browser ตรงด้วย key ของผู้ใช้ ไม่มี server; ไม่ log key หรือเนื้อหาคำขอ

export interface AiCredentials {
  apiKey: string
  model: string
}

/** ส่งคำขอหนึ่งครั้ง คืน input ของ tool; หมดเวลา 60 วินาที และยกเลิกได้ด้วย `signal` */
export async function callTool(creds: AiCredentials, request: AiRequest, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  let reason: 'timeout' | 'cancelled' | null = null
  const abort = (why: 'timeout' | 'cancelled') => {
    reason ??= why
    controller.abort()
  }
  const timer = setTimeout(() => abort('timeout'), AI_TIMEOUT_MS)
  const onCancel = () => abort('cancelled')
  if (signal?.aborted) onCancel()
  signal?.addEventListener('abort', onCancel)
  try {
    let response: Response
    try {
      response = await fetch(MESSAGES_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': creds.apiKey,
          'anthropic-version': API_VERSION,
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(messagesBody(creds.model, request)),
        signal: controller.signal,
      })
    } catch {
      throw new AiError(reason ?? 'network')
    }
    const json: unknown = await response.json().catch(() => null)
    if (reason) throw new AiError(reason)
    if (!response.ok) throw new AiError(errorFromResponse(response.status, json))
    return toolInput(json, request.tool.name)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onCancel)
  }
}

/** ความสามารถของผู้ช่วย AI ที่หน้าจอใช้ แยกไว้ให้ทดสอบหน้าจอด้วยตัวจำลองได้ */
export interface AiAssist {
  capture: (text: string, signal: AbortSignal) => Promise<CaptureSuggestion>
  breakdown: (input: BreakdownInput, signal: AbortSignal) => Promise<string[]>
  plan: (loops: Loop[], ctx: PlanContext, signal: AbortSignal) => Promise<AiPlan>
}

export function makeAssist(creds: AiCredentials, captureCtx: CaptureContext): AiAssist {
  return {
    capture: async (text, signal) => parseCapture(await callTool(creds, captureRequest(text, captureCtx), signal), captureCtx),
    breakdown: async (input, signal) => parseBreakdown(await callTool(creds, breakdownRequest(input), signal), input.steps),
    plan: async (loops, ctx, signal) => {
      const { request, refs } = planRequest(loops, ctx)
      return parsePlan(await callTool(creds, request, signal), refs, ctx.today)
    },
  }
}
