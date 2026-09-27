import { useEffect, useRef, useState } from 'react'
import {
  BellIcon,
  BellRingingIcon,
  XIcon,
  ChecksIcon,
  UserPlusIcon,
  WaveformIcon,
  ShieldWarningIcon,
  HeartbeatIcon,
  IdentificationCardIcon,
  UserFocusIcon,
} from '@phosphor-icons/react'
import { newToastAlerts } from '../../lib/stats'
import type { Alert, AlertType } from '../../types/safety'
import { Card, SeverityBadge } from '../common/ui'
import { timeAgo } from '../../lib/format'

interface Props {
  alerts: Alert[]
  unreadCount: number
  onMarkRead: (id: string) => Promise<unknown>
  onMarkAllRead: () => Promise<unknown>
  onOpen: (alert: Alert) => void
}

const TYPE_ICON: Record<AlertType, typeof BellIcon> = {
  new_contact: UserPlusIcon,
  contact_risk: UserFocusIcon,
  thread_risk: WaveformIcon,
  message_flagged: ShieldWarningIcon,
  child_wellbeing: HeartbeatIcon,
  personal_info_shared: IdentificationCardIcon,
}

const SEV_ICON_CLS = {
  none: 'bg-surface-3 text-muted',
  low: 'bg-warn/10 text-warn',
  medium: 'bg-alert/10 text-alert',
  high: 'bg-danger/10 text-danger',
}

export function AlertsFeed({ alerts, unreadCount, onMarkRead, onMarkAllRead, onOpen }: Props) {
  return (
    <Card
      title="Alerts"
      subtitle={unreadCount ? `${unreadCount} unread` : 'You’re all caught up'}
      icon={<BellIcon size={18} weight="duotone" aria-hidden />}
      action={
        unreadCount > 0 && (
          <button onClick={() => onMarkAllRead()} className="flex items-center gap-1 text-xs font-medium text-accent bg-transparent border-none hover:underline">
            <ChecksIcon size={13} weight="bold" aria-hidden /> Mark all read
          </button>
        )
      }
    >
      {alerts.length === 0 ? (
        <p className="text-sm text-subtle py-6 text-center m-0">No alerts. We'll ping you if anything needs you.</p>
      ) : (
        <ul className="flex flex-col gap-1 list-none p-0 m-0 max-h-[26rem] overflow-y-auto -mx-2 px-2">
          {alerts.map((a) => {
            const Icon = TYPE_ICON[a.type] ?? BellIcon
            return (
              <li key={a.id}>
                <button
                  onClick={() => {
                    if (!a.read) onMarkRead(a.id)
                    onOpen(a)
                  }}
                  className={`w-full text-left flex gap-3 rounded-lg px-2.5 py-2.5 border-none transition-colors hover:bg-surface-2 ${a.read ? 'bg-transparent opacity-55' : 'bg-transparent'}`}
                >
                  <span className={`relative w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${SEV_ICON_CLS[a.severity ?? 'none']}`}>
                    <Icon size={16} weight="duotone" aria-hidden />
                    {!a.read && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent ring-2 ring-surface" aria-label="unread" />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium text-fg truncate flex-1">{a.title}</span>
                      <span className="text-[0.65rem] text-subtle shrink-0">{timeAgo(a.created_at?.toMillis?.() ?? 0)}</span>
                    </span>
                    <span className="block text-xs text-muted mt-0.5 line-clamp-2">{a.body}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/** Pops a toast for medium/high alerts that arrive while the dashboard is open. */
export function AlertToasts({ alerts, onOpen }: Pick<Props, 'alerts' | 'onOpen'>) {
  const [mountedAt] = useState(() => Date.now())
  const shownIds = useRef(new Set<string>())
  const [toasts, setToasts] = useState<Alert[]>([])

  useEffect(() => {
    const fresh = newToastAlerts(alerts, mountedAt).filter((a) => !shownIds.current.has(a.id))
    if (!fresh.length) return
    fresh.forEach((a) => shownIds.current.add(a.id))
    setToasts((t) => [...fresh, ...t].slice(0, 3))
    const timer = setTimeout(() => setToasts((t) => t.filter((x) => !fresh.includes(x))), 9000)
    return () => clearTimeout(timer)
  }, [alerts, mountedAt])

  if (!toasts.length) return null
  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col gap-2 w-[min(380px,92vw)]" role="region" aria-live="assertive" aria-label="New alerts">
      {toasts.map((a) => (
        <div key={a.id} className={`panel bg-surface-2/95 backdrop-blur-xl p-4 animate-rise ${a.severity === 'high' ? 'ring-1 ring-danger/40' : 'ring-1 ring-alert/30'}`}>
          <div className="flex items-start gap-3">
            <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${SEV_ICON_CLS[a.severity]} ${a.severity === 'high' ? 'animate-pulse-ring' : ''}`}>
              <BellRingingIcon size={18} weight="fill" aria-hidden />
            </span>
            <button onClick={() => onOpen(a)} className="flex-1 text-left bg-transparent border-none p-0">
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold text-fg">{a.title}</span>
                <SeverityBadge severity={a.severity} />
              </span>
              <span className="block text-xs text-muted mt-1 line-clamp-3">{a.body}</span>
            </button>
            <button onClick={() => setToasts((t) => t.filter((x) => x.id !== a.id))} aria-label="Dismiss" className="bg-transparent border-none text-subtle hover:text-fg p-0">
              <XIcon size={16} />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
