import { useState } from 'react'
import {
  CheckIcon,
  EyeIcon,
  ProhibitIcon,
  UserPlusIcon,
  UsersThreeIcon,
  SparkleIcon,
  ChatTeardropTextIcon,
  ArrowsClockwiseIcon,
  CircleNotchIcon,
  CheckCircleIcon,
  WarningIcon,
} from '@phosphor-icons/react'
import type { Contact, ContactStatus } from '../../types/safety'
import { displayPlatform } from '../../types/channel'
import { Avatar, Button, Card, Chip, ContactStatusBadge, IconButton, SeverityBadge, type Tone } from '../common/ui'

interface Props {
  contacts: Contact[]
  onSetStatus: (id: string, status: ContactStatus) => Promise<unknown>
  onRevet: (id: string) => Promise<unknown>
  onOpenMessage: (docId: string) => void
}

const REC: Record<'approve' | 'watch' | 'block', { label: string; tone: Tone; ring: string }> = {
  approve: { label: 'Looks safe to approve', tone: 'ok', ring: 'ring-ok/30' },
  watch: { label: 'Approve and keep watching', tone: 'sky', ring: 'ring-accent-2/30' },
  block: { label: 'We recommend blocking', tone: 'danger', ring: 'ring-danger/40' },
}

function useAction() {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = async (key: string, call: () => Promise<unknown>) => {
    setBusy(key)
    setError(null)
    try {
      await call()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(null)
    }
  }
  return { busy, error, run }
}

function DecisionButtons({ c, onSetStatus, size = 'md' }: { c: Contact; onSetStatus: Props['onSetStatus']; size?: 'sm' | 'md' }) {
  const { busy, error, run } = useAction()
  const opts: { status: ContactStatus; label: string; icon: typeof CheckIcon; variant: 'ok' | 'sky' | 'danger' }[] = [
    { status: 'approved', label: 'Approve', icon: CheckIcon, variant: 'ok' },
    { status: 'watch', label: 'Watch', icon: EyeIcon, variant: 'sky' },
    { status: 'blocked', label: 'Block', icon: ProhibitIcon, variant: 'danger' },
  ]
  return (
    <div className="flex flex-wrap gap-2 items-center">
      {opts
        .filter((o) => o.status !== c.status)
        .map(({ status, label, icon: Icon, variant }) => (
          <Button key={status} size={size} variant={variant} disabled={!!busy} onClick={() => run(status, () => onSetStatus(c.id, status))}>
            {busy === status ? <CircleNotchIcon size={14} className="animate-spin" /> : <Icon size={14} weight="bold" aria-hidden />}
            {label}
          </Button>
        ))}
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  )
}

function VettingCard({ c, onSetStatus, onRevet, onOpenMessage }: { c: Contact } & Props) {
  const v = c.vetting
  const { busy, run } = useAction()
  const rec = v?.recommendation ? REC[v.recommendation] : null
  return (
    <li className={`rounded-xl bg-surface-2 ring-1 ${rec?.ring ?? 'ring-line'} p-4 flex flex-col gap-3 animate-rise`}>
      <div className="flex items-center gap-3">
        <Avatar src={c.profile_picture} size={42} alt={c.username} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-fg m-0 truncate">{c.username}</p>
          <p className="text-xs text-muted m-0">
            {displayPlatform(c.platform)} · {c.message_count} message{c.message_count !== 1 ? 's' : ''}
          </p>
        </div>
        {c.pfp_moderation?.status === 'censored' && <Chip tone="danger">flagged avatar</Chip>}
        <IconButton onClick={() => run('vet', () => onRevet(c.id))} disabled={!!busy} aria-label="Re-run AI vetting" title="Re-run AI vetting">
          {busy ? <CircleNotchIcon size={15} className="animate-spin" /> : <ArrowsClockwiseIcon size={15} />}
        </IconButton>
      </div>

      <div className="rounded-lg bg-bg/60 ring-1 ring-line p-3.5">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ai m-0 mb-2 flex items-center gap-1.5">
          <SparkleIcon size={12} weight="fill" aria-hidden /> AI vetting
        </p>
        {!v ? (
          <p className="text-sm text-muted m-0 flex items-center gap-2">
            <CircleNotchIcon size={14} className="animate-spin text-ai" aria-hidden /> Reading their first messages…
          </p>
        ) : v.status === 'needs_review' ? (
          <p className="text-sm text-review m-0">The automatic check couldn't finish. Review their messages yourself or retry.</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              {rec && <Chip tone={rec.tone}>{rec.label}</Chip>}
              <SeverityBadge severity={v.risk_level} label={`${v.risk_level} risk`} />
            </div>
            {v.summary && <p className="text-sm text-fg-soft m-0 leading-relaxed">{v.summary}</p>}
            {!!v.evidence?.length && (
              <ul className="m-0 p-0 list-none flex flex-col gap-1">
                {v.evidence.map((e, i) => (
                  <li key={i} className="text-xs text-fg-soft flex items-start gap-1.5">
                    <WarningIcon size={13} className="text-alert shrink-0 mt-px" aria-hidden />
                    <span>
                      {e.point}
                      {e.message_id && (
                        <button onClick={() => onOpenMessage(e.message_id!)} className="ml-1.5 text-[0.68rem] font-medium text-accent bg-accent/10 hover:bg-accent/20 border-none rounded px-1.5 py-px">
                          view
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {!!v.positive_signals?.length && (
              <ul className="m-0 p-0 list-none flex flex-col gap-1">
                {v.positive_signals.map((p, i) => (
                  <li key={i} className="text-xs text-ok flex items-start gap-1.5">
                    <CheckCircleIcon size={13} className="shrink-0 mt-px" aria-hidden /> {p}
                  </li>
                ))}
              </ul>
            )}
            {v.suggested_parent_question && (
              <p className="text-xs text-fg-soft m-0 mt-1 flex items-start gap-1.5 rounded-md bg-accent/5 ring-1 ring-accent/15 px-2.5 py-2">
                <ChatTeardropTextIcon size={14} weight="duotone" className="shrink-0 mt-px text-accent" aria-hidden />
                <span>
                  <span className="text-accent font-medium">Ask your child:</span> “{v.suggested_parent_question}”
                </span>
              </p>
            )}
          </div>
        )}
      </div>
      <DecisionButtons c={c} onSetStatus={onSetStatus} />
    </li>
  )
}

export function ContactQueue(props: Props) {
  const pending = props.contacts.filter((c) => c.status === 'pending')
  if (pending.length === 0) return null
  return (
    <Card
      title={`New contacts waiting (${pending.length})`}
      subtitle="Your child only sees their messages after you decide."
      icon={<UserPlusIcon size={18} weight="duotone" className="text-warn" aria-hidden />}
      className="ring-1 ring-warn/20"
    >
      <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3 list-none p-0 m-0">
        {pending.map((c) => (
          <VettingCard key={c.id} c={c} {...props} />
        ))}
      </ul>
    </Card>
  )
}

export function ContactList({ contacts, onSetStatus }: Pick<Props, 'contacts' | 'onSetStatus'>) {
  const [showAll, setShowAll] = useState(false)
  const decided = contacts.filter((c) => c.status !== 'pending').sort((a, b) => (b.message_count ?? 0) - (a.message_count ?? 0))
  const shown = showAll ? decided : decided.slice(0, 6)
  return (
    <Card
      title="Contacts"
      icon={<UsersThreeIcon size={18} weight="duotone" aria-hidden />}
      action={
        decided.length > 6 && (
          <button onClick={() => setShowAll((v) => !v)} className="text-xs font-medium text-accent bg-transparent border-none hover:underline">
            {showAll ? 'Show less' : `All ${decided.length}`}
          </button>
        )
      }
    >
      {shown.length === 0 ? (
        <p className="text-sm text-subtle m-0">No approved or blocked contacts yet.</p>
      ) : (
        <ul className={`flex flex-col gap-1 list-none p-0 m-0 ${showAll ? 'max-h-96 overflow-y-auto pr-1' : ''}`}>
          {shown.map((c) => (
            <li key={c.id} className="group rounded-lg px-2 py-2 hover:bg-surface-2 transition-colors">
              <div className="flex items-center gap-2.5">
                <Avatar src={c.profile_picture} size={32} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-fg m-0 truncate">{c.username}</p>
                  <p className="text-[0.7rem] text-muted m-0">
                    {displayPlatform(c.platform)} · {c.message_count} msgs{c.flagged_count ? ` · ${c.flagged_count} flagged` : ''}
                  </p>
                </div>
                <ContactStatusBadge status={c.status} />
              </div>
              <div className="hidden group-hover:block group-focus-within:block mt-2 pl-[42px]">
                <DecisionButtons c={c} onSetStatus={onSetStatus} size="sm" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
