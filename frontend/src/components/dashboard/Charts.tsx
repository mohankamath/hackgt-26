import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartLineUpIcon, TagIcon } from '@phosphor-icons/react'
import type { ActivityDay, CategoryCount } from '../../lib/stats'
import { Card } from '../common/ui'

const C = {
  safe: '#34d399',
  masked: '#fbbf24',
  censored: '#fb7185',
  needs_review: '#c084fc',
  sent: '#38bdf8',
  grid: '#1f2b45',
  tick: '#8494b2',
}
const SEVERITY_COLORS = { none: '#56657f', low: '#fbbf24', medium: '#fb923c', high: '#fb7185' }

const tooltipProps = {
  contentStyle: { background: '#121b2f', border: '1px solid #2c3b5c', borderRadius: 10, fontSize: 12, color: '#e8eef8' },
  labelStyle: { color: '#c3cee2', fontWeight: 600 },
  itemStyle: { padding: 0 },
  cursor: { fill: 'rgb(45 212 191 / 0.06)', stroke: '#2c3b5c' },
}

const SERIES = [
  { key: 'safe', name: 'Safe', color: C.safe },
  { key: 'masked', name: 'Masked', color: C.masked },
  { key: 'needs_review', name: 'Review', color: C.needs_review },
  { key: 'censored', name: 'Hidden', color: C.censored },
] as const

export function ActivityChart({ data }: { data: ActivityDay[] }) {
  const empty = data.every((d) => d.safe + d.masked + d.censored + d.needs_review + d.sent === 0)
  return (
    <Card
      title="Activity"
      subtitle="Messages received per day, by outcome"
      icon={<ChartLineUpIcon size={18} weight="duotone" aria-hidden />}
      action={
        <ul className="hidden sm:flex gap-3 list-none m-0 p-0">
          {[...SERIES, { key: 'sent', name: 'Sent', color: C.sent }].map((s) => (
            <li key={s.key} className="flex items-center gap-1.5 text-[0.68rem] text-muted">
              <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
              {s.name}
            </li>
          ))}
        </ul>
      }
    >
      {empty ? (
        <p className="text-sm text-subtle py-16 text-center m-0">No messages this week yet.</p>
      ) : (
        <div className="h-60" role="img" aria-label="Stacked area chart of messages per day by safety status">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
              <defs>
                {[...SERIES, { key: 'sent', color: C.sent }].map((s) => (
                  <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 6" vertical={false} stroke={C.grid} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} tick={{ fill: C.tick }} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} tick={{ fill: C.tick }} />
              <Tooltip {...tooltipProps} />
              {SERIES.map((s) => (
                <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stackId="in" stroke={s.color} strokeWidth={2} fill={`url(#g-${s.key})`} />
              ))}
              <Area type="monotone" dataKey="sent" name="Sent" stroke={C.sent} strokeWidth={2} strokeDasharray="4 4" fill="url(#g-sent)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}

export function CategoryBreakdown({ data }: { data: CategoryCount[] }) {
  return (
    <Card title="What got flagged" subtitle="Moderation categories this period" icon={<TagIcon size={18} weight="duotone" aria-hidden />}>
      {data.length === 0 ? (
        <p className="text-sm text-subtle py-16 text-center m-0">Nothing flagged. Nice.</p>
      ) : (
        <div className="h-60" role="img" aria-label={`Flag categories: ${data.map((d) => `${d.label} ${d.count}`).join(', ')}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 4, bottom: 0 }} barCategoryGap={8}>
              <XAxis type="number" allowDecimals={false} hide />
              <YAxis type="category" dataKey="label" width={138} tickLine={false} axisLine={false} fontSize={11} tick={{ fill: C.tick }} />
              <Tooltip {...tooltipProps} />
              <Bar dataKey="count" name="Messages" radius={[0, 6, 6, 0]} background={{ fill: '#121b2f', radius: 6 }}>
                {data.map((d) => (
                  <Cell key={d.category} fill={SEVERITY_COLORS[d.severity]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}
