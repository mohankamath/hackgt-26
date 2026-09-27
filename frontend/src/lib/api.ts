import type { ModerationCategory, MessageStatus, Severity } from '../types/message'
import type { ContactStatus } from '../types/safety'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
  } catch {
    throw new Error("Can't reach the Screened server. Is the backend running?")
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const detail = body?.detail
    const message =
      typeof detail === 'string' ? detail : Array.isArray(detail) ? detail[0]?.msg : detail?.error
    throw new Error(message || `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export interface SendMessageResponse {
  status: string
  platform: string
  message_id?: string
}

/** Send via the backend (it checks the contact isn't pending/blocked first). */
export function sendMessage(platform: string, channelId: string, content: string) {
  return post<SendMessageResponse>('/send', { platform, channel_id: channelId, content })
}

export interface PreviewWarning {
  type: 'sensitive' | 'inappropriate'
  label: string
  match: string | null
}

export interface PreviewResult {
  status: MessageStatus
  ok: boolean
  warnings: PreviewWarning[]
  pii: { type: string; label: string; match: string }[]
  categories: ModerationCategory[]
  severity: Severity
  tip: string | null
  check_unavailable: boolean
}

/** AI + PII check of a message the child is about to send. */
export function previewMessage(text: string, signal?: AbortSignal) {
  return request<PreviewResult>('/moderate/preview', { method: 'POST', body: JSON.stringify({ text }), signal })
}

export function setContactStatus(contactId: string, status: ContactStatus) {
  return post<{ contact_id: string; status: ContactStatus; messages_updated: number }>(
    `/contacts/${encodeURIComponent(contactId)}/status`,
    { status },
  )
}

export function vetContact(contactId: string) {
  return post<unknown>(`/contacts/${encodeURIComponent(contactId)}/vet`)
}

export function analyzeThread(threadId: string) {
  return post<unknown>(`/threads/${encodeURIComponent(threadId)}/analyze`)
}

export function generateDigest(days = 7) {
  return post<unknown>('/digest/generate', { days })
}

export function reviewMessage(collection: string, docId: string, status: 'safe' | 'masked' | 'censored') {
  return request<unknown>(`/messages/${collection}/${encodeURIComponent(docId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export async function signedMediaUrl(path: string) {
  const r = await request<{ url: string }>(`/media/signed-url?path=${encodeURIComponent(path)}`)
  return r.url
}
