import { ChatCircleDotsIcon, EyeSlashIcon, ShieldCheckIcon, HourglassMediumIcon, WarningOctagonIcon } from '@phosphor-icons/react'
import type { OverviewStats as Stats } from '../../lib/stats'

interface Props {
  stats: Stats
  highRiskThreads: number
}

export default function OverviewStats({ stats, highRiskThreads }: Props) {
  const tiles = [
    { label: 'Messages received', value: stats.received, icon: ChatCircleDotsIcon, cls: 'text-carrot-orange-500 bg-carrot-orange-50' },
    { label: 'Safe rate', value: `${stats.safeRate}%`, icon: ShieldCheckIcon, cls: 'text-green-600 bg-green-50' },
    { label: 'Hidden / words masked', value: `${stats.censored} / ${stats.masked}`, icon: EyeSlashIcon, cls: 'text-red-500 bg-red-50' },
    { label: 'Needs your review', value: stats.needsReview, icon: HourglassMediumIcon, cls: 'text-violet-600 bg-violet-50' },
    { label: 'Risky conversations', value: highRiskThreads, icon: WarningOctagonIcon, cls: 'text-orange-600 bg-orange-50' },
  ]
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
      {tiles.map(({ label, value, icon: Icon, cls }) => (
        <div key={label} className="bg-white rounded-2xl px-5 py-4 flex items-center gap-3 shadow-sm">
          <span className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${cls}`}>
            <Icon size={22} weight="duotone" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-2xl font-bold text-ink-black-800 m-0">{value}</p>
            <p className="text-xs text-ink-black-400 m-0">{label}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
