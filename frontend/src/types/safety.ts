import type { Timestamp } from 'firebase/firestore'
import type { RiskLevel, Severity } from './message'

export type ContactStatus = 'pending' | 'approved' | 'watch' | 'blocked'
export type Recommendation = 'approve' | 'watch' | 'block'

export interface Vetting {
  status: 'ok' | 'needs_review'
  error?: string | null
  recommendation: Recommendation | null
  risk_level?: RiskLevel
  summary?: string
  evidence?: { point: string; message_id: string | null }[]
  positive_signals?: string[]
  suggested_parent_question?: string
  vetted_at?: Timestamp
  message_count_at_vet?: number
}

/** `contacts/{platform:user_id}` */
export interface Contact {
  id: string
  platform: string
  user_id: string
  username: string
  profile_picture: string | null
  status: ContactStatus
  message_count: number
  flagged_count?: number
  first_seen_at?: Timestamp
  last_message_at?: Timestamp
  threads?: string[]
  vetting?: Vetting | null
  pfp_moderation?: { status: string; severity?: Severity } | null
}

export interface ThreadSignal {
  type: string
  label: string
  explanation: string
  evidence_message_ids: string[]
}

/** `threads/{platform:channel_id}` */
export interface ThreadRisk {
  id: string
  platform: string
  channel_id: string
  channel_name?: string
  is_group?: boolean
  participants?: string[]
  risk_level?: RiskLevel
  risk_score?: number
  signals?: ThreadSignal[]
  summary?: string
  recommended_action?: string
  child_tip?: string | null
  analysis_status?: 'ok' | 'needs_review'
  analysis_error?: string | null
  history?: { at: Timestamp; risk_score: number; risk_level: RiskLevel }[]
  updated_at?: Timestamp
  last_message_at?: Timestamp
}

export type AlertType =
  | 'new_contact'
  | 'contact_risk'
  | 'thread_risk'
  | 'message_flagged'
  | 'child_wellbeing'
  | 'personal_info_shared'

export interface Alert {
  id: string
  type: AlertType
  severity: Severity
  title: string
  body: string
  thread_id?: string | null
  contact_id?: string | null
  message_doc_id?: string | null
  read: boolean
  created_at?: Timestamp
}

export interface Digest {
  id: string
  headline: string
  highlights: string[]
  concerns: string[]
  positive_connections: string[]
  conversation_starters: string[]
  stats?: {
    messages_received: number
    messages_sent: number
    safe_rate: number
    status_counts?: Record<string, number>
    top_categories?: Record<string, number>
  }
  period_days: number
  status: 'ok' | 'needs_review'
  error?: string | null
  created_at?: Timestamp
}

export type Sensitivity = 'low' | 'balanced' | 'strict'

export interface AppSettings {
  privacyMode: boolean
  customKeywords: string[]
  sensitivity: Sensitivity
  childName: string
  childAvatar: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  privacyMode: false,
  customKeywords: [],
  sensitivity: 'balanced',
  childName: 'Your child',
  childAvatar: '',
}
