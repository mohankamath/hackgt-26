import { ChatsIcon, ShieldCheckIcon, EyeSlashIcon, HourglassMediumIcon, WaveformIcon } from '@phosphor-icons/react'
import type { OverviewStats as Stats } from '../../lib/stats'

interface Props {
  stats: Stats
  highRiskThreads: number
}

export default function OverviewStats({ stats, highRiskThreads }: Props) {
  const tiles = [
    { label: 'Messages received', value: stats.received, hint: `${stats.sent} sent`, icon: ChatsIcon, color: 'text-accent-2', glow: 'from-accent-2/20' },
    { label: 'Safe rate', value: `${stats.safeRate}%`, hint: 'no action needed', icon: ShieldCheckIcon, color: 'text-ok', glow: 'from-ok/20' },
    { label: 'Hidden · masked', value: `${stats.censored} · ${stats.masked}`, hint: 'kept from your child', icon: EyeSlashIcon, color: 'text-danger', glow: 'from-danger/20' },
    { label: 'Needs your review', value: stats.needsReview, hint: stats.needsReview ? 'waiting on you' : 'all clear', icon: HourglassMediumIcon, color: 'text-review', glow: 'from-review/20' },
    { label: 'Risky conversations', value: highRiskThreads, hint: 'medium or high risk', icon: WaveformIcon, color: 'text-alert', glow: 'from-alert/20' },
  ]
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
      {tiles.map(({ label, value, hint, icon: Icon, color, glow }, i) => (
        <div key={label} className="panel relative overflow-hidden px-4 py-4 animate-rise" style={{ animationDelay: `${i * 50}ms` }}>
          <div className={`absolute -top-10 -right-10 w-28 h-28 rounded-full bg-gradient-to-br ${glow} to-transparent blur-2xl`} aria-hidden />
          <div className="relative flex items-center justify-between">
            <p className="text-xs text-muted m-0">{label}</p>
            <Icon size={18} weight="duotone" className={color} aria-hidden />
          </div>
          <p className="relative font-display text-3xl font-semibold text-fg m-0 mt-2 tabular-nums">{value}</p>
          <p className="relative text-[0.7rem] text-subtle m-0 mt-0.5">{hint}</p>
        </div>
      ))}
    </div>
  )
}
