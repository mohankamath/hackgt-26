import { useEffect, useRef, useState } from 'react'
import { BellRingingIcon, BellIcon, XIcon, ChecksIcon } from '@phosphor-icons/react'
import { newToastAlerts } from '../../lib/stats'
import type { Alert } from '../../types/safety'
import { Card, SeverityBadge } from '../common/ui'
import { timeAgo } from '../../lib/format'

interface Props {
  alerts: Alert[]
  unreadCount: number
  onMarkRead: (id: string) => Promise<unknown>
  onMarkAllRead: () => Promise<unknown>
  onOpen: (alert: Alert) => void
}

const BORDER = { none: 'border-ink-black-100', low: 'border-amber-200', medium: 'border-orange-300', high: 'border-red-300' }

export function AlertsFeed({ alerts, unreadCount, onMarkRead, onMarkAllRead, onOpen }: Props) {
  return (
    <Card
      title={`Alerts${unreadCount ? ` (${unreadCount} new)` : ''}`}
      icon={<BellIcon size={18} weight="bold" className="text-spicy-orange-500" aria-hidden />}
      action={
        unreadCount > 0 && (
          <button onClick={() => onMarkAllRead()} className="flex items-center gap-1 text-[0.7rem] font-semibold text-spicy-orange-500 bg-transparent border-none cursor-pointer hover:underline">
            <ChecksIcon size={12} weight="bold" aria-hidden /> Mark all read
          </button>
        )
      }
    >
      {alerts.length === 0 ? (
        <p className="text-xs text-ink-black-300 py-4 text-center">No alerts. We'll let you know if anything needs you.</p>
      ) : (
        <ul className="flex flex-col gap-2 list-none p-0 m-0 max-h-96 overflow-y-auto pr-1">
          {alerts.map((a) => (
            <li key={a.id}>
              <button
                onClick={() => {
                  if (!a.read) onMarkRead(a.id)
                  onOpen(a)
                }}
                className={`w-full text-left bg-white border rounded-xl px-3 py-2.5 cursor-pointer hover:bg-soft-peach-50 transition-colors ${BORDER[a.severity ?? 'none']} ${a.read ? 'opacity-60' : ''}`}
              >
                <div className="flex items-center gap-2">
                  {!a.read && <span className="w-2 h-2 rounded-full bg-spicy-orange-500 shrink-0" aria-label="unread" />}
                  <span className="text-sm font-bold text-ink-black-800 flex-1 min-w-0 truncate">{a.title}</span>
                  <SeverityBadge severity={a.severity} />
                </div>
                <p className="text-xs text-ink-black-500 mt-1 mb-0 line-clamp-3">{a.body}</p>
                <p className="text-[0.65rem] text-ink-black-300 mt-1 mb-0">{timeAgo(a.created_at?.toMillis?.() ?? 0)}</p>
              </button>
            </li>
          ))}
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
    <div className="fixed bottom-4 right-4 z-40 flex flex-col gap-2 w-[min(360px,90vw)]" role="region" aria-live="assertive" aria-label="New alerts">
      {toasts.map((a) => (
        <div key={a.id} className={`bg-white rounded-2xl shadow-xl border-2 ${BORDER[a.severity]} p-4 animate-pop-in`}>
          <div className="flex items-start gap-2">
            <BellRingingIcon size={20} weight="fill" className="text-spicy-orange-500 shrink-0" aria-hidden />
            <button onClick={() => onOpen(a)} className="flex-1 text-left bg-transparent border-none p-0 cursor-pointer">
              <p className="text-sm font-bold text-ink-black-800 m-0">{a.title}</p>
              <p className="text-xs text-ink-black-500 mt-1 mb-0 line-clamp-3">{a.body}</p>
            </button>
            <button onClick={() => setToasts((t) => t.filter((x) => x.id !== a.id))} aria-label="Dismiss" className="bg-transparent border-none cursor-pointer text-ink-black-300 hover:text-ink-black-600 p-0">
              <XIcon size={16} weight="bold" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
