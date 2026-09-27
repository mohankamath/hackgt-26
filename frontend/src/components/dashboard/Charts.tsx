import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts'
import { ChartBarIcon, TagIcon } from '@phosphor-icons/react'
import type { ActivityDay, CategoryCount } from '../../lib/stats'
import { Card } from '../common/ui'

const COLORS = {
  safe: '#4ade80',
  masked: '#fbbf24',
  censored: '#ef4444',
  needs_review: '#8b5cf6',
  sent: '#f8833a',
}

const SEVERITY_COLORS = { none: '#a0aec5', low: '#fbbf24', medium: '#fb923c', high: '#ef4444' }

export function ActivityChart({ data }: { data: ActivityDay[] }) {
  const empty = data.every((d) => d.safe + d.masked + d.censored + d.needs_review + d.sent === 0)
  return (
    <Card title="Activity, last 7 days" icon={<ChartBarIcon size={18} weight="bold" className="text-spicy-orange-500" aria-hidden />}>
      {empty ? (
        <p className="text-xs text-ink-black-300 py-10 text-center">No messages this week yet.</p>
      ) : (
        <div className="h-56" role="img" aria-label="Stacked bar chart of messages per day by safety status">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eff1f5" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} />
              <Tooltip cursor={{ fill: '#fdf6e7' }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="safe" name="Safe" stackId="in" fill={COLORS.safe} />
              <Bar dataKey="masked" name="Words hidden" stackId="in" fill={COLORS.masked} />
              <Bar dataKey="needs_review" name="Needs review" stackId="in" fill={COLORS.needs_review} />
              <Bar dataKey="censored" name="Hidden" stackId="in" fill={COLORS.censored} radius={[4, 4, 0, 0]} />
              <Bar dataKey="sent" name="Sent by child" fill={COLORS.sent} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}

export function CategoryBreakdown({ data }: { data: CategoryCount[] }) {
  return (
    <Card title="What got flagged" icon={<TagIcon size={18} weight="bold" className="text-spicy-orange-500" aria-hidden />}>
      {data.length === 0 ? (
        <p className="text-xs text-ink-black-300 py-10 text-center">Nothing flagged. Nice.</p>
      ) : (
        <div className="h-56" role="img" aria-label={`Flag categories: ${data.map((d) => `${d.label} ${d.count}`).join(', ')}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 8, bottom: 0 }}>
              <XAxis type="number" allowDecimals={false} hide />
              <YAxis type="category" dataKey="label" width={130} tickLine={false} axisLine={false} fontSize={11} />
              <Tooltip cursor={{ fill: '#fdf6e7' }} />
              <Bar dataKey="count" name="Messages" radius={[0, 4, 4, 0]}>
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
