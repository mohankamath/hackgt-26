import type { Timestamp } from 'firebase/firestore'

export type MessageStatus = 'safe' | 'masked' | 'censored' | 'needs_review' | 'blocked'
export type Severity = 'none' | 'low' | 'medium' | 'high'
export type RiskLevel = 'none' | 'low' | 'medium' | 'high'

/** One policy hit from OpenAI omni-moderation or the local keyword layer. */
export interface ModerationCategory {
  category: string
  label: string
  score: number
  severity: Severity
  /** "text" | "attachment:<i>" | "profile_picture" */
  source?: string
}

export interface Moderation {
  categories: ModerationCategory[]
  scores: Record<string, number>
  reasons: string[]
  error?: string | null
}

export interface MessageAttachment {
  /** Public URL. Null when the attachment is hidden (flagged / needs review). */
  url: string | null
  /** Original URL for parent review of hidden attachments (Discord CDN). */
  review_url?: string | null
  /** Private Firebase Storage path for hidden Instagram media (parent gets a signed URL). */
  storage_path?: string | null
  filename: string
  type: string
  kind?: 'image' | 'video' | 'file'
  flagged?: boolean
  status?: MessageStatus
  categories?: ModerationCategory[]
  severity?: Severity
  error?: string | null
}

/** A document in the Firestore `messages` or `sent_messages` collection. */
export interface FirestoreMessage {
  /** Firestore document ID ("platform:message_id") */
  id?: string
  /** Which collection the doc came from */
  collection?: 'messages' | 'sent_messages'
  message_id: string
  platform: string
  direction?: 'incoming' | 'outgoing'
  user_id: string
  username: string
  contact_id?: string
  thread_id?: string
  channel_id: string
  channel_name: string
  server_id: string
  is_group?: boolean
  message: string
  masked_content?: string | null
  status?: MessageStatus
  /** Kept for compatibility: true when status === 'censored' */
  censored: boolean
  severity?: Severity
  flagged_words: string[]
  moderation?: Moderation
  attachments?: MessageAttachment[]
  profile_picture: string | null
  profile_picture_flagged?: boolean
  visible_to_child?: boolean
  coach_tip?: string | null
  reviewed_by_parent?: boolean
  pii?: { type: string; label: string }[]
  timestamp: Timestamp
  /** True when the message was sent by the child (from sent_messages collection) */
  is_sent?: boolean
}

/** Effective status for older docs that predate the `status` field. */
export function messageStatus(m: Pick<FirestoreMessage, 'status' | 'censored'>): MessageStatus {
  return m.status ?? (m.censored ? 'censored' : 'safe')
}

/** Whether the child should see this message at all (sent messages are always theirs). */
export function isVisibleToChild(m: FirestoreMessage): boolean {
  if (m.is_sent) return true
  if (messageStatus(m) === 'blocked') return false
  return m.visible_to_child === true
}

export const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?|$)/i
export const VIDEO_EXTENSIONS = /\.(mp4|mov|webm|mkv|avi|m4v)(\?|$)/i

export function isImageAttachment(a: Pick<MessageAttachment, 'url' | 'type' | 'kind' | 'filename'>): boolean {
  if (a.kind) return a.kind === 'image'
  return !!a.type?.startsWith('image/') || IMAGE_EXTENSIONS.test(a.url ?? a.filename ?? '')
}

export function isVideoAttachment(a: Pick<MessageAttachment, 'url' | 'type' | 'kind' | 'filename'>): boolean {
  if (a.kind) return a.kind === 'video'
  return !!a.type?.startsWith('video/') || VIDEO_EXTENSIONS.test(a.url ?? a.filename ?? '')
}

export function isAttachmentHidden(a: MessageAttachment): boolean {
  return !!a.flagged || a.status === 'censored' || a.status === 'needs_review' || !a.url
}
