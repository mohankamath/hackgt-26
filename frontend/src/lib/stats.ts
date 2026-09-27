/** Pure data transforms for the parent dashboard (unit-tested in stats.test.ts). */
import { messageStatus, type FirestoreMessage, type MessageStatus, type Severity } from '../types/message'
import type { Alert } from '../types/safety'

const DAY = 86_400_000

const ts = (m: { timestamp?: { toMillis?: () => number } }) => m.timestamp?.toMillis?.() ?? 0

export interface OverviewStats {
  total: number
  received: number
  sent: number
  safe: number
  masked: number
  censored: number
  needsReview: number
  blocked: number
  /** % of received messages that needed no intervention */
  safeRate: number
}

export function overviewStats(messages: FirestoreMessage[]): OverviewStats {
  const s: OverviewStats = { total: messages.length, received: 0, sent: 0, safe: 0, masked: 0, censored: 0, needsReview: 0, blocked: 0, safeRate: 100 }
  for (const m of messages) {
    if (m.is_sent) {
      s.sent += 1
      continue
    }
    s.received += 1
    const st = messageStatus(m)
    if (st === 'safe') s.safe += 1
    else if (st === 'masked') s.masked += 1
    else if (st === 'censored') s.censored += 1
    else if (st === 'needs_review') s.needsReview += 1
    else if (st === 'blocked') s.blocked += 1
  }
  s.safeRate = s.received ? Math.round((s.safe / s.received) * 100) : 100
  return s
}

export interface ActivityDay {
  label: string
  dayStart: number
  safe: number
  masked: number
  censored: number
  needs_review: number
  sent: number
}

/** Last ``days`` calendar days (oldest first) with per-status counts, for a stacked bar chart. */
export function activityByDay(messages: FirestoreMessage[], now: Date = new Date(), days = 7): ActivityDay[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const out: ActivityDay[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today - i * DAY)
    // Recompute midnight per day so DST shifts don't skew buckets.
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    out.push({ label: d.toLocaleDateString([], { weekday: 'short' }), dayStart: start, safe: 0, masked: 0, censored: 0, needs_review: 0, sent: 0 })
  }
  for (const m of messages) {
    const t = ts(m)
    const bucket = out.find((b, i) => t >= b.dayStart && t < (out[i + 1]?.dayStart ?? b.dayStart + DAY))
    if (!bucket) continue
    if (m.is_sent) {
      bucket.sent += 1
      continue
    }
    const st: MessageStatus = messageStatus(m)
    if (st === 'blocked') continue
    bucket[st] += 1
  }
  return out
}

export interface CategoryCount {
  category: string
  label: string
  count: number
  severity: Severity
}

const SEV_RANK: Record<Severity, number> = { none: 0, low: 1, medium: 2, high: 3 }

/** How often each moderation category fired on received messages (grooming hints excluded). */
export function categoryBreakdown(messages: FirestoreMessage[], top = 8): CategoryCount[] {
  const map = new Map<string, CategoryCount>()
  for (const m of messages) {
    if (m.is_sent) continue
    const seen = new Set<string>()
    for (const c of m.moderation?.categories ?? []) {
      if (c.category === 'grooming_hint' || seen.has(c.category)) continue
      seen.add(c.category)
      const cur = map.get(c.category) ?? { category: c.category, label: c.label, count: 0, severity: c.severity }
      cur.count += 1
      if (SEV_RANK[c.severity] > SEV_RANK[cur.severity]) cur.severity = c.severity
      map.set(c.category, cur)
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || SEV_RANK[b.severity] - SEV_RANK[a.severity]).slice(0, top)
}

/** Unread first, then by severity, then newest. */
export function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort(
    (a, b) =>
      Number(a.read) - Number(b.read) ||
      SEV_RANK[b.severity ?? 'none'] - SEV_RANK[a.severity ?? 'none'] ||
      ts({ timestamp: b.created_at }) - ts({ timestamp: a.created_at }),
  )
}

/** Alerts newer than ``sinceMs`` that should pop a toast (unread, medium+). */
export function newToastAlerts(alerts: Alert[], sinceMs: number): Alert[] {
  return alerts.filter((a) => !a.read && SEV_RANK[a.severity ?? 'none'] >= 2 && ts({ timestamp: a.created_at }) > sinceMs)
}

/** Messages shown in the review feed, honouring privacy mode and the flagged filter. */
export function reviewFeed(
  messages: FirestoreMessage[],
  opts: { privacyMode: boolean; filter: 'all' | 'flagged' | 'review'; search: string },
): FirestoreMessage[] {
  const q = opts.search.trim().toLowerCase()
  return messages
    .filter((m) => {
      const st = messageStatus(m)
      const flagged = st !== 'safe' || !!m.profile_picture_flagged || (m.pii?.length ?? 0) > 0
      if ((opts.privacyMode || opts.filter === 'flagged') && !flagged) return false
      if (opts.filter === 'review' && st !== 'needs_review') return false
      if (!q) return true
      return (
        m.message.toLowerCase().includes(q) ||
        m.username.toLowerCase().includes(q) ||
        m.channel_name.toLowerCase().includes(q)
      )
    })
    .sort((a, b) => ts(b) - ts(a))
}
