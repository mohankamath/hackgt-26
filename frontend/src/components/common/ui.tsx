import { useState } from 'react'
import { UserIcon } from '@phosphor-icons/react'
import type { MessageStatus, ModerationCategory, RiskLevel, Severity } from '../../types/message'
import type { ContactStatus } from '../../types/safety'

/** Avatar with a friendly default when there's no (or a flagged / broken) picture. */
export function Avatar({ src, size = 40, alt = '', className = '' }: { src?: string | null; size?: number; alt?: string; className?: string }) {
  const [broken, setBroken] = useState(false)
  const style = { width: size, height: size }
  if (!src || broken) {
    return (
      <span
        style={style}
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
        className={`shrink-0 inline-flex items-center justify-center rounded-full bg-carrot-orange-50 text-carrot-orange-500 ${className}`}
      >
        <UserIcon size={Math.round(size / 2)} weight="duotone" aria-hidden />
      </span>
    )
  }
  return <img src={src} alt={alt} style={style} onError={() => setBroken(true)} className={`shrink-0 rounded-full object-cover ${className}`} />
}

const SEVERITY_STYLES: Record<Severity, string> = {
  none: 'bg-ink-black-50 text-ink-black-500',
  low: 'bg-amber-50 text-amber-700',
  medium: 'bg-orange-100 text-orange-700',
  high: 'bg-red-100 text-red-700',
}

export function SeverityBadge({ severity, label }: { severity: Severity | RiskLevel | undefined; label?: string }) {
  const s = (severity ?? 'none') as Severity
  return (
    <span className={`inline-flex items-center text-[0.65rem] font-bold uppercase tracking-wide rounded-md px-1.5 py-0.5 ${SEVERITY_STYLES[s]}`}>
      {label ?? (s === 'none' ? 'no risk' : `${s}`)}
    </span>
  )
}

const STATUS_META: Record<MessageStatus, { label: string; cls: string }> = {
  safe: { label: 'Safe', cls: 'bg-green-50 text-green-700' },
  masked: { label: 'Words hidden', cls: 'bg-amber-50 text-amber-700' },
  censored: { label: 'Hidden', cls: 'bg-red-100 text-red-700' },
  needs_review: { label: 'Needs review', cls: 'bg-violet-100 text-violet-700' },
  blocked: { label: 'Blocked sender', cls: 'bg-ink-black-100 text-ink-black-600' },
}

export function StatusBadge({ status }: { status: MessageStatus }) {
  const m = STATUS_META[status]
  return <span className={`inline-flex items-center text-[0.65rem] font-bold rounded-md px-1.5 py-0.5 ${m.cls}`}>{m.label}</span>
}

export function CategoryTags({ categories, max = 4 }: { categories?: ModerationCategory[]; max?: number }) {
  if (!categories?.length) return null
  const unique = categories.filter((c, i, arr) => arr.findIndex((x) => x.category === c.category) === i)
  return (
    <span className="inline-flex flex-wrap gap-1">
      {unique.slice(0, max).map((c) => (
        <span key={c.category} className={`text-[0.65rem] font-semibold rounded-md px-1.5 py-0.5 ${SEVERITY_STYLES[c.severity]}`}>
          {c.label}
        </span>
      ))}
      {unique.length > max && <span className="text-[0.65rem] text-ink-black-400">+{unique.length - max}</span>}
    </span>
  )
}

const CONTACT_META: Record<ContactStatus, { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'bg-amber-50 text-amber-700' },
  approved: { label: 'Approved', cls: 'bg-green-50 text-green-700' },
  watch: { label: 'Watching', cls: 'bg-sky-50 text-sky-700' },
  blocked: { label: 'Blocked', cls: 'bg-ink-black-100 text-ink-black-600' },
}

export function ContactStatusBadge({ status }: { status: ContactStatus }) {
  const m = CONTACT_META[status]
  return <span className={`inline-flex text-[0.65rem] font-bold rounded-md px-1.5 py-0.5 ${m.cls}`}>{m.label}</span>
}

/** 0-100 risk meter bar. */
export function RiskMeter({ score = 0, level }: { score?: number; level?: RiskLevel }) {
  const color = level === 'high' ? 'bg-red-500' : level === 'medium' ? 'bg-orange-400' : level === 'low' ? 'bg-amber-300' : 'bg-green-400'
  return (
    <div className="w-full h-2 rounded-full bg-ink-black-50 overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} aria-label="Risk score">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.max(4, Math.min(100, score))}%` }} />
    </div>
  )
}

export function Card({ title, icon, action, children, className = '' }: { title?: string; icon?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`bg-white rounded-2xl p-5 shadow-sm ${className}`}>
      {(title || action) && (
        <div className="flex items-center gap-2 mb-3">
          {icon}
          {title && <h3 className="text-sm font-bold text-ink-black-800">{title}</h3>}
          {action && <div className="ml-auto">{action}</div>}
        </div>
      )}
      {children}
    </section>
  )
}
