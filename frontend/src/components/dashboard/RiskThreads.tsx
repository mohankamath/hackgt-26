import { useState } from 'react'
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts'
import { ArrowsClockwiseIcon, BrainIcon, CircleNotchIcon, ArrowRightIcon } from '@phosphor-icons/react'
import { analyzeThread } from '../../lib/api'
import type { ThreadRisk } from '../../types/safety'
import { Card, Chip, IconButton, RiskRing, SeverityBadge } from '../common/ui'
import { timeAgo } from '../../lib/format'

interface Props {
  threads: ThreadRisk[]
  onOpenMessage: (docId: string) => void
  /** Only show medium+ threads (privacy mode) */
  riskyOnly?: boolean
}

const RISK_STROKE = { none: '#34d399', low: '#fbbf24', medium: '#fb923c', high: '#fb7185' }

function Sparkline({ history, level }: { history: NonNullable<ThreadRisk['history']>; level: keyof typeof RISK_STROKE }) {
  if (history.length < 2) return null
  const data = history.map((h) => ({ score: h.risk_score }))
  const color = RISK_STROKE[level]
  return (
    <div className="w-28 h-9" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id={`spark-${level}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis domain={[0, 100]} hide />
          <Area type="monotone" dataKey="score" stroke={color} strokeWidth={2} fill={`url(#spark-${level})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function ThreadRow({ t, onOpenMessage }: { t: ThreadRisk; onOpenMessage: Props['onOpenMessage'] }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const level = t.risk_level ?? 'none'
  const rerun = async () => {
    setBusy(true)
    setErr(null)
    try {
      await analyzeThread(t.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }
  const accent = level === 'high' ? 'before:bg-danger' : level === 'medium' ? 'before:bg-alert' : 'before:bg-transparent'
  return (
    <li className={`relative rounded-xl bg-surface-2 ring-1 ring-line p-4 overflow-hidden before:absolute before:left-0 before:inset-y-0 before:w-[3px] ${accent}`}>
      <div className="flex items-start gap-4">
        <RiskRing score={t.risk_score ?? 0} level={level} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-fg truncate">{t.channel_name || t.id}</span>
            <Chip>{t.platform}</Chip>
            <SeverityBadge severity={level} label={t.risk_level ? `${t.risk_level} risk` : 'not analyzed'} />
            {t.analysis_status === 'needs_review' && <Chip tone="review">analysis failed</Chip>}
          </div>
          {t.summary && <p className="text-sm text-fg-soft mt-1.5 mb-0 leading-relaxed">{t.summary}</p>}
          {t.recommended_action && (
            <p className="text-xs text-accent mt-1.5 mb-0 flex items-center gap-1">
              <ArrowRightIcon size={12} weight="bold" aria-hidden /> {t.recommended_action}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {t.history && <Sparkline history={t.history} level={level} />}
          <IconButton onClick={rerun} disabled={busy} aria-label={`Re-analyze ${t.channel_name ?? 'thread'}`} title="Re-analyze">
            {busy ? <CircleNotchIcon size={15} className="animate-spin" /> : <ArrowsClockwiseIcon size={15} />}
          </IconButton>
        </div>
      </div>

      {!!t.signals?.length && (
        <ol className="mt-3 ml-[68px] flex flex-col gap-2 list-none p-0 m-0 border-l border-line-strong pl-4">
          {t.signals.map((s, i) => (
            <li key={i} className="relative text-xs text-fg-soft before:absolute before:-left-[21px] before:top-1 before:w-2 before:h-2 before:rounded-full before:bg-alert before:ring-4 before:ring-surface-2">
              <span className="font-semibold text-alert">{s.label}</span>
              <span className="text-muted"> · {s.explanation}</span>
              {s.evidence_message_ids.map((id, j) => (
                <button key={id} onClick={() => onOpenMessage(id)} className="ml-1.5 text-[0.68rem] font-medium text-accent bg-accent/10 hover:bg-accent/20 border-none rounded px-1.5 py-px">
                  msg {j + 1}
                </button>
              ))}
            </li>
          ))}
        </ol>
      )}
      <p className="text-[0.68rem] text-subtle mt-3 mb-0 ml-[68px]">
        {t.updated_at ? `Analyzed ${timeAgo(t.updated_at.toMillis())}` : 'Waiting for enough messages to analyze'}
      </p>
      {err && <p className="text-xs text-danger mt-1 mb-0 ml-[68px]">{err}</p>}
    </li>
  )
}

export default function RiskThreads({ threads, onOpenMessage, riskyOnly }: Props) {
  const shown = threads.filter((t) => !riskyOnly || t.risk_level === 'medium' || t.risk_level === 'high').slice(0, 8)
  return (
    <Card
      title="Conversation risk"
      subtitle="AI reads whole chats to catch patterns single messages hide: secrecy, gifts, meetups, moving apps."
      icon={<BrainIcon size={18} weight="duotone" className="text-ai" aria-hidden />}
      action={<Chip tone="ai">AI</Chip>}
    >
      {shown.length === 0 ? (
        <p className="text-sm text-subtle py-8 text-center m-0">No conversations to show yet.</p>
      ) : (
        <ul className="flex flex-col gap-3 list-none p-0 m-0">
          {shown.map((t) => (
            <ThreadRow key={t.id} t={t} onOpenMessage={onOpenMessage} />
          ))}
        </ul>
      )}
    </Card>
  )
}
