import { useState } from 'react'
import {
  CheckCircleIcon,
  EyeIcon,
  ProhibitIcon,
  UserPlusIcon,
  UsersIcon,
  SparkleIcon,
  ChatTeardropTextIcon,
  ArrowsClockwiseIcon,
  CircleNotchIcon,
} from '@phosphor-icons/react'
import type { Contact, ContactStatus } from '../../types/safety'
import { displayPlatform } from '../../types/channel'
import { Avatar, Card, ContactStatusBadge, SeverityBadge } from '../common/ui'

interface Props {
  contacts: Contact[]
  onSetStatus: (id: string, status: ContactStatus) => Promise<unknown>
  onRevet: (id: string) => Promise<unknown>
  onOpenMessage: (docId: string) => void
}

const REC_STYLE = {
  approve: { label: 'Looks safe to approve', cls: 'bg-green-50 text-green-700 border-green-200' },
  watch: { label: 'Approve, but keep watching', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  block: { label: 'We recommend blocking', cls: 'bg-red-50 text-red-700 border-red-200' },
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

function DecisionButtons({ c, onSetStatus, compact }: { c: Contact; onSetStatus: Props['onSetStatus']; compact?: boolean }) {
  const { busy, error, run } = useAction()
  const btn = (status: ContactStatus, label: string, Icon: typeof CheckCircleIcon, cls: string) =>
    c.status !== status && (
      <button
        key={status}
        disabled={!!busy}
        onClick={() => run(status, () => onSetStatus(c.id, status))}
        className={`flex items-center gap-1.5 ${compact ? 'px-2 py-1' : 'px-3 py-2'} rounded-xl text-xs font-semibold border-none cursor-pointer transition-colors disabled:opacity-50 ${cls}`}
      >
        {busy === status ? <CircleNotchIcon size={14} className="animate-spin" /> : <Icon size={14} weight="bold" aria-hidden />}
        {label}
      </button>
    )
  return (
    <div className="flex flex-wrap gap-2 items-center">
      {btn('approved', 'Approve', CheckCircleIcon, 'bg-green-500 text-white hover:bg-green-600')}
      {btn('watch', 'Watch', EyeIcon, 'bg-sky-500 text-white hover:bg-sky-600')}
      {btn('blocked', 'Block', ProhibitIcon, 'bg-red-500 text-white hover:bg-red-600')}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}

function VettingCard({ c, onSetStatus, onRevet, onOpenMessage }: { c: Contact } & Props) {
  const v = c.vetting
  const { busy, run } = useAction()
  const rec = v?.recommendation ? REC_STYLE[v.recommendation] : null
  return (
    <li className="bg-white rounded-xl p-4 border border-amber-100">
      <div className="flex items-center gap-3">
        <Avatar src={c.profile_picture} size={40} alt={c.username} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-ink-black-800 m-0 truncate">{c.username}</p>
          <p className="text-xs text-ink-black-400 m-0">
            {displayPlatform(c.platform)} · {c.message_count} message{c.message_count !== 1 ? 's' : ''}
            {c.pfp_moderation?.status === 'censored' && <span className="text-red-600 font-semibold"> · inappropriate profile picture</span>}
          </p>
        </div>
        <button
          onClick={() => run('vet', () => onRevet(c.id))}
          disabled={!!busy}
          aria-label="Re-run AI vetting"
          className="bg-soft-peach-50 hover:bg-soft-peach-100 border-none rounded-lg p-1.5 cursor-pointer text-ink-black-500 disabled:opacity-50"
        >
          {busy ? <CircleNotchIcon size={14} className="animate-spin" /> : <ArrowsClockwiseIcon size={14} weight="bold" />}
        </button>
      </div>

      <div className="mt-3 rounded-xl bg-soft-peach-50 p-3">
        <p className="text-[0.65rem] font-bold uppercase tracking-wide text-ink-black-400 m-0 mb-1 flex items-center gap-1">
          <SparkleIcon size={12} weight="fill" className="text-spicy-orange-500" aria-hidden /> AI vetting
        </p>
        {!v ? (
          <p className="text-xs text-ink-black-400 m-0">Analyzing their first messages…</p>
        ) : v.status === 'needs_review' ? (
          <p className="text-xs text-violet-700 m-0">The automatic check couldn't finish. Review their messages yourself or try again.</p>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              {rec && <span className={`text-xs font-bold border rounded-lg px-2 py-0.5 ${rec.cls}`}>{rec.label}</span>}
              <SeverityBadge severity={v.risk_level} label={`${v.risk_level} risk`} />
            </div>
            {v.summary && <p className="text-sm text-ink-black-700 mt-2 mb-0">{v.summary}</p>}
            {!!v.evidence?.length && (
              <ul className="mt-2 mb-0 pl-4 text-xs text-ink-black-600 flex flex-col gap-0.5">
                {v.evidence.map((e, i) => (
                  <li key={i}>
                    {e.point}
                    {e.message_id && (
                      <button onClick={() => onOpenMessage(e.message_id!)} className="ml-1 text-[0.65rem] font-semibold text-spicy-orange-600 bg-transparent border-none cursor-pointer underline p-0">
                        view
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!!v.positive_signals?.length && <p className="text-xs text-green-700 mt-2 mb-0">✓ {v.positive_signals.join(' · ')}</p>}
            {v.suggested_parent_question && (
              <p className="text-xs text-ink-black-600 mt-2 mb-0 flex items-start gap-1">
                <ChatTeardropTextIcon size={14} weight="duotone" className="shrink-0 mt-px text-carrot-orange-500" aria-hidden />
                <span>
                  <span className="font-bold">Ask your child:</span> “{v.suggested_parent_question}”
                </span>
              </p>
            )}
          </>
        )}
      </div>
      <div className="mt-3">
        <DecisionButtons c={c} onSetStatus={onSetStatus} />
      </div>
    </li>
  )
}

export function ContactQueue(props: Props) {
  const pending = props.contacts.filter((c) => c.status === 'pending')
  if (pending.length === 0) return null
  return (
    <section className="bg-amber-50 border border-amber-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <UserPlusIcon size={20} weight="bold" className="text-amber-600" aria-hidden />
        <h3 className="text-sm font-bold text-amber-800 m-0">New contacts waiting ({pending.length})</h3>
        <p className="text-xs text-amber-700 m-0 ml-auto">Your child sees their messages only after you approve.</p>
      </div>
      <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3 list-none p-0 m-0">
        {pending.map((c) => (
          <VettingCard key={c.id} c={c} {...props} />
        ))}
      </ul>
    </section>
  )
}

export function ContactList({ contacts, onSetStatus }: Pick<Props, 'contacts' | 'onSetStatus'>) {
  const [showAll, setShowAll] = useState(false)
  const decided = contacts
    .filter((c) => c.status !== 'pending')
    .sort((a, b) => (b.message_count ?? 0) - (a.message_count ?? 0))
  const shown = showAll ? decided : decided.slice(0, 6)
  return (
    <Card
      title="Contacts"
      icon={<UsersIcon size={18} weight="bold" className="text-spicy-orange-500" aria-hidden />}
      action={
        decided.length > 6 && (
          <button onClick={() => setShowAll((v) => !v)} className="text-[0.7rem] font-semibold text-spicy-orange-500 bg-transparent border-none cursor-pointer hover:underline">
            {showAll ? 'Show less' : `View all (${decided.length})`}
          </button>
        )
      }
    >
      {shown.length === 0 ? (
        <p className="text-xs text-ink-black-300">No approved or blocked contacts yet.</p>
      ) : (
        <ul className={`flex flex-col gap-3 list-none p-0 m-0 ${showAll ? 'max-h-80 overflow-y-auto pr-1' : ''}`}>
          {shown.map((c) => (
            <li key={c.id} className="flex items-center gap-2.5 flex-wrap">
              <Avatar src={c.profile_picture} size={32} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink-black-800 m-0 truncate">{c.username}</p>
                <p className="text-[0.7rem] text-ink-black-400 m-0">
                  {displayPlatform(c.platform)} · {c.message_count} msgs{c.flagged_count ? ` · ${c.flagged_count} flagged` : ''}
                </p>
              </div>
              <ContactStatusBadge status={c.status} />
              <DecisionButtons c={c} onSetStatus={onSetStatus} compact />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
