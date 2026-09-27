import { useState } from 'react'
import { NewspaperIcon, CircleNotchIcon, ChatTeardropTextIcon, HeartIcon, WarningIcon, SparkleIcon } from '@phosphor-icons/react'
import { generateDigest } from '../../lib/api'
import type { Digest } from '../../types/safety'
import { Button, Card, SectionLabel } from '../common/ui'
import { timeAgo } from '../../lib/format'

function Section({ title, items, icon, tone }: { title: string; items: string[]; icon: React.ReactNode; tone: string }) {
  if (!items.length) return null
  return (
    <div>
      <SectionLabel>
        <span className={`inline-flex items-center gap-1 ${tone}`}>{icon}{title}</span>
      </SectionLabel>
      <ul className="m-0 p-0 list-none flex flex-col gap-1">
        {items.map((x, i) => (
          <li key={i} className="text-sm text-fg-soft pl-3 relative before:absolute before:left-0 before:top-2 before:w-1 before:h-1 before:rounded-full before:bg-line-strong">
            {x}
          </li>
        ))}
      </ul>
    </div>
  )
}

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

  return (
    <Card
      title="Weekly digest"
      subtitle={digest ? `Generated ${timeAgo(digest.created_at?.toMillis?.() ?? 0)}` : 'AI summary of the week'}
      icon={<NewspaperIcon size={18} weight="duotone" className="text-ai" aria-hidden />}
      action={
        <Button size="sm" variant="primary" onClick={generate} disabled={busy}>
          {busy ? <CircleNotchIcon size={13} className="animate-spin" /> : <SparkleIcon size={13} weight="fill" aria-hidden />}
          {digest ? 'Refresh' : 'Generate'}
        </Button>
      }
    >
      {error && <p className="text-xs text-danger mt-0 mb-2">{error}</p>}
      {!digest ? (
        <p className="text-sm text-muted m-0 leading-relaxed">
          A calm summary of the week with ideas for talking with your child. Only stats go to the AI, never message text.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="font-display text-lg font-semibold text-fg m-0 leading-snug">{digest.headline}</p>
          {digest.stats && (
            <div className="grid grid-cols-3 gap-2">
              {[
                ['Received', digest.stats.messages_received],
                ['Sent', digest.stats.messages_sent],
                ['Safe', `${digest.stats.safe_rate}%`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-surface-2 ring-1 ring-line px-3 py-2">
                  <p className="text-[0.65rem] text-subtle m-0 uppercase tracking-wider">{k}</p>
                  <p className="font-display text-lg font-semibold text-fg m-0 tabular-nums">{v}</p>
                </div>
              ))}
            </div>
          )}
          <Section title="Highlights" items={digest.highlights} icon={<SparkleIcon size={11} aria-hidden />} tone="text-accent" />
          <Section title="Worth a look" items={digest.concerns} icon={<WarningIcon size={11} aria-hidden />} tone="text-alert" />
          <Section title="Healthy connections" items={digest.positive_connections} icon={<HeartIcon size={11} aria-hidden />} tone="text-ok" />
          {!!digest.conversation_starters.length && (
            <div className="rounded-xl bg-gradient-to-br from-ai/15 to-accent-2/10 ring-1 ring-ai/25 p-4">
              <SectionLabel>
                <span className="inline-flex items-center gap-1 text-ai">
                  <ChatTeardropTextIcon size={12} weight="fill" aria-hidden /> Conversation starters
                </span>
              </SectionLabel>
              {digest.conversation_starters.map((q, i) => (
                <p key={i} className="text-sm text-fg m-0 mt-1.5 leading-relaxed">“{q}”</p>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
