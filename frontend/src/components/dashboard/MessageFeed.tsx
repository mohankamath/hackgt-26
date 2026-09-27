import { MagnifyingGlassIcon, EyeSlashIcon, PaperclipIcon, ChatsIcon, CaretRightIcon } from '@phosphor-icons/react'
import { messageStatus, type FirestoreMessage } from '../../types/message'
import { displayPlatform } from '../../types/channel'
import { Avatar, CategoryTags, Chip, StatusBadge } from '../common/ui'
import { formatDateTime } from '../../lib/format'

export type FeedFilter = 'all' | 'flagged' | 'review'

interface Props {
  messages: FirestoreMessage[]
  filter: FeedFilter
  onFilter: (f: FeedFilter) => void
  search: string
  onSearch: (q: string) => void
  privacyMode: boolean
  onOpen: (m: FirestoreMessage) => void
  loading: boolean
  error: Error | null
}

const STATUS_BAR: Record<string, string> = {
  safe: 'bg-transparent',
  masked: 'bg-warn',
  censored: 'bg-danger',
  needs_review: 'bg-review',
  blocked: 'bg-subtle',
}

export default function MessageFeed({ messages, filter, onFilter, search, onSearch, privacyMode, onOpen, loading, error }: Props) {
  const tabs: { key: FeedFilter; label: string }[] = [
    ...(privacyMode ? [] : [{ key: 'all' as const, label: 'All' }]),
    { key: 'flagged', label: 'Flagged' },
    { key: 'review', label: 'Needs review' },
  ]
  return (
    <section className="panel flex flex-col min-h-0 animate-rise">
      <header className="p-4 border-b border-line flex flex-wrap items-center gap-3">
        <ChatsIcon size={18} weight="duotone" className="text-accent" aria-hidden />
        <h3 className="text-[0.95rem] font-semibold m-0">Messages</h3>
        <div className="flex p-0.5 rounded-lg bg-bg ring-1 ring-line" role="tablist" aria-label="Message filter">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={filter === t.key}
              onClick={() => onFilter(t.key)}
              className={`px-3 py-1 rounded-md text-xs font-medium border-none transition-colors ${filter === t.key ? 'bg-surface-3 text-fg' : 'bg-transparent text-muted hover:text-fg'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <label className="ml-auto relative flex items-center">
          <span className="sr-only">Search messages</span>
          <MagnifyingGlassIcon size={14} className="absolute left-3 text-subtle" aria-hidden />
          <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search…" className="field pl-8 pr-3 py-1.5 text-sm w-52" />
        </label>
      </header>
      {privacyMode && (
        <p className="px-4 py-2 text-xs text-warn bg-warn/5 border-b border-line m-0 flex items-center gap-1.5">
          <EyeSlashIcon size={14} aria-hidden /> Privacy mode: only flagged messages are shown.
        </p>
      )}
      <ul className="list-none m-0 p-0 overflow-y-auto max-h-[38rem]">
        {loading && <li className="p-8 text-center text-sm text-muted">Loading…</li>}
        {error && <li className="p-8 text-center text-sm text-danger">Couldn't load messages.</li>}
        {!loading && messages.length === 0 && <li className="p-8 text-center text-sm text-subtle">Nothing here.</li>}
        {messages.slice(0, 200).map((m) => {
          const status = messageStatus(m)
          return (
            <li key={m.id ?? m.message_id} className="border-b border-line/60 last:border-none">
              <button onClick={() => onOpen(m)} className="group relative w-full text-left bg-transparent hover:bg-surface-2 border-none px-4 py-3 flex gap-3 transition-colors">
                <span className={`absolute left-0 inset-y-2 w-[3px] rounded-r ${STATUS_BAR[status]}`} aria-hidden />
                <Avatar src={m.is_sent ? null : m.profile_picture_flagged ? null : m.profile_picture} size={34} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-fg">{m.is_sent ? 'Your child' : m.username}</span>
                    <span className="text-[0.7rem] text-subtle">
                      {displayPlatform(m.platform)} · {m.channel_name}
                    </span>
                    {status !== 'safe' && <StatusBadge status={status} />}
                    {!!m.pii?.length && <Chip tone="warn">personal info</Chip>}
                    <span className="ml-auto text-[0.68rem] text-subtle tabular-nums">{formatDateTime(m.timestamp?.toMillis?.() ?? 0)}</span>
                  </div>
                  <p className="text-sm text-muted m-0 mt-0.5 truncate">
                    {m.message || (m.attachments?.length ? <span className="inline-flex items-center gap-1"><PaperclipIcon size={12} aria-hidden /> attachment</span> : '')}
                  </p>
                  {!!m.moderation?.categories?.length && <div className="mt-1.5"><CategoryTags categories={m.moderation.categories} /></div>}
                </div>
                <CaretRightIcon size={14} className="self-center text-subtle opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
