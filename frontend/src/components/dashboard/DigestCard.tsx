import { useState } from 'react'
import { NewspaperIcon, CircleNotchIcon, ChatTeardropTextIcon, HeartIcon, WarningIcon, SparkleIcon } from '@phosphor-icons/react'
import { generateDigest } from '../../lib/api'
import type { Digest } from '../../types/safety'
import { Card } from '../common/ui'
import { timeAgo } from '../../lib/format'

export default function DigestCard({ digest }: { digest: Digest | null }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generate = async () => {
    setBusy(true)
    setError(null)
    try {
      await generateDigest(7)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate digest')
    } finally {
      setBusy(false)
    }
  }

  const Section = ({ title, items, icon }: { title: string; items: string[]; icon: React.ReactNode }) =>
    items.length ? (
      <div>
        <p className="text-[0.7rem] font-bold uppercase tracking-wide text-ink-black-400 m-0 mb-1 flex items-center gap-1">{icon}{title}</p>
        <ul className="m-0 pl-4 text-sm text-ink-black-700 flex flex-col gap-0.5">
          {items.map((x, i) => <li key={i}>{x}</li>)}
        </ul>
      </div>
    ) : null

  return (
    <Card
      title="Weekly digest"
      icon={<NewspaperIcon size={18} weight="bold" className="text-spicy-orange-500" aria-hidden />}
      action={
        <button onClick={generate} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border-none cursor-pointer bg-spicy-orange-500 text-white hover:bg-spicy-orange-600 disabled:opacity-50">
          {busy ? <CircleNotchIcon size={12} className="animate-spin" /> : <SparkleIcon size={12} weight="fill" aria-hidden />}
          {digest ? 'Refresh' : 'Generate'}
        </button>
      }
    >
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      {!digest ? (
        <p className="text-xs text-ink-black-400">
          Get a calm, AI-written summary of the week with ideas for talking with your child. Only stats are sent to the AI, never message text.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-base font-bold text-ink-black-800 m-0">{digest.headline}</p>
          {digest.stats && (
            <p className="text-xs text-ink-black-400 m-0">
              {digest.stats.messages_received} received · {digest.stats.messages_sent} sent · {digest.stats.safe_rate}% safe · {timeAgo(digest.created_at?.toMillis?.() ?? 0)}
            </p>
          )}
          <Section title="Highlights" items={digest.highlights} icon={<SparkleIcon size={12} aria-hidden />} />
          <Section title="Worth a look" items={digest.concerns} icon={<WarningIcon size={12} aria-hidden />} />
          <Section title="Healthy connections" items={digest.positive_connections} icon={<HeartIcon size={12} aria-hidden />} />
          {!!digest.conversation_starters.length && (
            <div className="bg-soft-peach-50 rounded-xl p-3">
              <p className="text-[0.7rem] font-bold uppercase tracking-wide text-carrot-orange-700 m-0 mb-1 flex items-center gap-1">
                <ChatTeardropTextIcon size={12} weight="fill" aria-hidden /> Conversation starters
              </p>
              {digest.conversation_starters.map((q, i) => (
                <p key={i} className="text-sm text-ink-black-700 m-0 mt-1">“{q}”</p>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
