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
        className={`shrink-0 inline-flex items-center justify-center rounded-full bg-surface-3 text-muted ring-1 ring-line ${className}`}
      >
        <UserIcon size={Math.round(size / 2)} weight="duotone" aria-hidden />
      </span>
    )
  }
  return <img src={src} alt={alt} style={style} onError={() => setBroken(true)} className={`shrink-0 rounded-full object-cover ring-1 ring-line ${className}`} />
}

/** Small uppercase label chip. `tone` picks the colour family. */
export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'alert' | 'danger' | 'review' | 'ai' | 'sky'

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-muted ring-line',
  accent: 'bg-accent/10 text-accent ring-accent/25',
  ok: 'bg-ok/10 text-ok ring-ok/25',
  warn: 'bg-warn/10 text-warn ring-warn/25',
  alert: 'bg-alert/10 text-alert ring-alert/25',
  danger: 'bg-danger/10 text-danger ring-danger/30',
  review: 'bg-review/10 text-review ring-review/25',
  ai: 'bg-ai/10 text-ai ring-ai/25',
  sky: 'bg-accent-2/10 text-accent-2 ring-accent-2/25',
}

export function Chip({ tone = 'neutral', children, className = '' }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[0.65rem] font-semibold uppercase tracking-wider rounded-md px-1.5 py-0.5 ring-1 ring-inset ${TONES[tone]} ${className}`}>
      {children}
    </span>
  )
}

const SEVERITY_TONE: Record<Severity, Tone> = { none: 'neutral', low: 'warn', medium: 'alert', high: 'danger' }

export function SeverityBadge({ severity, label }: { severity: Severity | RiskLevel | undefined; label?: string }) {
  const s = (severity ?? 'none') as Severity
  return <Chip tone={SEVERITY_TONE[s]}>{label ?? (s === 'none' ? 'no risk' : s)}</Chip>
}

const STATUS_META: Record<MessageStatus, { label: string; tone: Tone }> = {
  safe: { label: 'Safe', tone: 'ok' },
  masked: { label: 'Masked', tone: 'warn' },
  censored: { label: 'Hidden', tone: 'danger' },
  needs_review: { label: 'Needs review', tone: 'review' },
  blocked: { label: 'Blocked', tone: 'neutral' },
}

export function StatusBadge({ status }: { status: MessageStatus }) {
  const m = STATUS_META[status]
  return <Chip tone={m.tone}>{m.label}</Chip>
}

export function CategoryTags({ categories, max = 4 }: { categories?: ModerationCategory[]; max?: number }) {
  if (!categories?.length) return null
  const unique = categories.filter((c, i, arr) => arr.findIndex((x) => x.category === c.category) === i)
  return (
    <span className="inline-flex flex-wrap gap-1">
      {unique.slice(0, max).map((c) => (
        <span key={c.category} className={`text-[0.68rem] font-medium rounded-md px-1.5 py-0.5 ring-1 ring-inset ${TONES[SEVERITY_TONE[c.severity]]}`}>
          {c.label}
        </span>
      ))}
      {unique.length > max && <span className="text-[0.68rem] text-subtle">+{unique.length - max}</span>}
    </span>
  )
}

const CONTACT_META: Record<ContactStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'warn' },
  approved: { label: 'Approved', tone: 'ok' },
  watch: { label: 'Watching', tone: 'sky' },
  blocked: { label: 'Blocked', tone: 'neutral' },
}

export function ContactStatusBadge({ status }: { status: ContactStatus }) {
  const m = CONTACT_META[status]
  return <Chip tone={m.tone}>{m.label}</Chip>
}

const RISK_BAR: Record<RiskLevel, string> = {
  none: 'from-ok/70 to-ok',
  low: 'from-warn/70 to-warn',
  medium: 'from-alert/70 to-alert',
  high: 'from-danger/70 to-danger',
}

/** 0-100 risk meter bar. */
export function RiskMeter({ score = 0, level = 'none' }: { score?: number; level?: RiskLevel }) {
  return (
    <div className="w-full h-1.5 rounded-full bg-surface-3 overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} aria-label="Risk score">
      <div className={`h-full rounded-full bg-gradient-to-r transition-all duration-500 ${RISK_BAR[level]}`} style={{ width: `${Math.max(3, Math.min(100, score))}%` }} />
    </div>
  )
}

/** Circular 0-100 gauge used for thread risk. */
export function RiskRing({ score = 0, level = 'none', size = 52 }: { score?: number; level?: RiskLevel; size?: number }) {
  const r = (size - 6) / 2
  const c = 2 * Math.PI * r
  const color = { none: 'var(--color-ok)', low: 'var(--color-warn)', medium: 'var(--color-alert)', high: 'var(--color-danger)' }[level]
  return (
    <span className="relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }} role="img" aria-label={`Risk score ${score} of 100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--color-surface-3)" strokeWidth={5} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={5} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, score) / 100)} className="transition-all duration-700" />
      </svg>
      <span className="absolute font-display text-sm font-bold" style={{ color }}>{score}</span>
    </span>
  )
}

export function Card({ title, icon, action, children, className = '', subtitle }: { title?: string; subtitle?: string; icon?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`panel p-5 animate-rise ${className}`}>
      {(title || action) && (
        <header className="flex items-start gap-2.5 mb-4">
          {icon && <span className="mt-0.5 text-accent">{icon}</span>}
          <div className="min-w-0">
            {title && <h3 className="text-[0.95rem] font-semibold text-fg m-0">{title}</h3>}
            {subtitle && <p className="text-xs text-muted m-0 mt-0.5">{subtitle}</p>}
          </div>
          {action && <div className="ml-auto shrink-0">{action}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

type BtnVariant = 'primary' | 'ghost' | 'ok' | 'sky' | 'danger' | 'outline-danger' | 'warn'

const BTN: Record<BtnVariant, string> = {
  primary: 'bg-accent-gradient text-abyss font-semibold hover:brightness-110 shadow-glow',
  ghost: 'bg-surface-3 text-fg-soft hover:bg-line hover:text-fg ring-1 ring-inset ring-line',
  ok: 'bg-ok/15 text-ok ring-1 ring-inset ring-ok/30 hover:bg-ok/25',
  sky: 'bg-accent-2/15 text-accent-2 ring-1 ring-inset ring-accent-2/30 hover:bg-accent-2/25',
  warn: 'bg-warn/15 text-warn ring-1 ring-inset ring-warn/30 hover:bg-warn/25',
  danger: 'bg-danger/15 text-danger ring-1 ring-inset ring-danger/30 hover:bg-danger/25',
  'outline-danger': 'bg-transparent text-danger ring-1 ring-inset ring-danger/40 hover:bg-danger/10',
}

export function Button({
  variant = 'ghost',
  size = 'md',
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' }) {
  const pad = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm'
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border-none font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${pad} ${BTN[variant]} ${className}`}
    />
  )
}

export function IconButton({ className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border-none bg-transparent text-muted hover:text-fg hover:bg-surface-3 transition-colors disabled:opacity-40 ${className}`}
    />
  )
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-subtle m-0 mb-1.5">{children}</p>
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="sg-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2dd4bf" />
          <stop offset="1" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
      <path d="M32 4 8 13v17c0 15 10 25 24 30 14-5 24-15 24-30V13L32 4z" fill="#0d1424" stroke="url(#sg-logo)" strokeWidth="4" strokeLinejoin="round" />
      <path d="M18 36c4-4 8-4 12 0s8 4 12 0 6-3 6-3" fill="none" stroke="url(#sg-logo)" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}
