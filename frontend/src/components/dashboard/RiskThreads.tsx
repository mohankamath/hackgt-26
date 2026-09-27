import { useState } from 'react'
import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts'
import { ArrowsClockwiseIcon, BrainIcon, CircleNotchIcon } from '@phosphor-icons/react'
import { analyzeThread } from '../../lib/api'
import type { ThreadRisk } from '../../types/safety'
import { Card, RiskMeter, SeverityBadge } from '../common/ui'
import { timeAgo } from '../../lib/format'

interface Props {
  threads: ThreadRisk[]
  onOpenMessage: (docId: string) => void
  /** Only show medium+ threads (privacy mode) */
  riskyOnly?: boolean
}

function Sparkline({ history }: { history: NonNullable<ThreadRisk['history']> }) {
  if (history.length < 2) return null
  const data = history.map((h) => ({ score: h.risk_score }))
  return (
    <div className="w-24 h-8" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <YAxis domain={[0, 100]} hide />
          <Line type="monotone" dataKey="score" stroke="#eb5814" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function ThreadRow({ t, onOpenMessage }: { t: ThreadRisk; onOpenMessage: Props['onOpenMessage'] }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
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
  return (
    <li className="border border-soft-peach-100 rounded-xl p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-bold text-sm text-ink-black-800">{t.channel_name || t.id}</span>
        <span className="text-[0.65rem] uppercase font-semibold text-ink-black-400">{t.platform}</span>
        <SeverityBadge severity={t.risk_level} label={t.risk_level ? `${t.risk_level} risk` : 'not analyzed'} />
        {t.analysis_status === 'needs_review' && <span className="text-[0.65rem] text-violet-600 font-semibold">analysis failed, retry</span>}
        <span className="ml-auto flex items-center gap-2">
          {t.history && <Sparkline history={t.history} />}
          <button
            onClick={rerun}
            disabled={busy}
            aria-label={`Re-analyze ${t.channel_name ?? 'thread'}`}
            className="bg-soft-peach-50 hover:bg-soft-peach-100 border-none rounded-lg p-1.5 cursor-pointer text-ink-black-500 disabled:opacity-50"
          >
            {busy ? <CircleNotchIcon size={14} className="animate-spin" /> : <ArrowsClockwiseIcon size={14} weight="bold" />}
          </button>
        </span>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <RiskMeter score={t.risk_score} level={t.risk_level} />
        <span className="text-xs font-bold text-ink-black-600 w-8 text-right">{t.risk_score ?? '–'}</span>
      </div>
      {t.summary && <p className="text-sm text-ink-black-600 mt-2 mb-0">{t.summary}</p>}
      {t.recommended_action && <p className="text-xs text-ink-black-500 mt-1 mb-0"><span className="font-bold">Next step:</span> {t.recommended_action}</p>}
      {!!t.signals?.length && (
        <ol className="mt-3 flex flex-col gap-1.5 list-none p-0 m-0 border-l-2 border-orange-200 pl-3">
          {t.signals.map((s, i) => (
            <li key={i} className="text-xs text-ink-black-600">
              <span className="font-bold text-orange-700">{s.label}</span>: {s.explanation}
              {s.evidence_message_ids.map((id, j) => (
                <button key={id} onClick={() => onOpenMessage(id)} className="ml-1 text-[0.65rem] font-semibold text-spicy-orange-600 bg-transparent border-none cursor-pointer underline p-0">
                  evidence {j + 1}
                </button>
              ))}
            </li>
          ))}
        </ol>
      )}
      <p className="text-[0.65rem] text-ink-black-300 mt-2 mb-0">
        {t.updated_at ? `Analyzed ${timeAgo(t.updated_at.toMillis())}` : 'Waiting for enough messages to analyze'}
      </p>
      {err && <p className="text-xs text-red-600 mt-1 mb-0">{err}</p>}
    </li>
  )
}

export default function RiskThreads({ threads, onOpenMessage, riskyOnly }: Props) {
  const shown = threads.filter((t) => !riskyOnly || t.risk_level === 'medium' || t.risk_level === 'high').slice(0, 8)
  return (
    <Card title="Conversation risk (AI)" icon={<BrainIcon size={18} weight="bold" className="text-spicy-orange-500" aria-hidden />}>
      <p className="text-xs text-ink-black-400 -mt-1 mb-3">
        SafeGuard reads whole conversations to spot patterns single messages can't show, like secrecy requests, gifts, or moving to another app.
      </p>
      {shown.length === 0 ? (
        <p className="text-xs text-ink-black-300 py-4 text-center">No conversations to show.</p>
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
