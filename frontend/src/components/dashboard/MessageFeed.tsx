import { FunnelIcon, MagnifyingGlassIcon, EyeSlashIcon, ImageIcon } from '@phosphor-icons/react'
import { messageStatus, type FirestoreMessage } from '../../types/message'
import { displayPlatform } from '../../types/channel'
import { Avatar, CategoryTags, StatusBadge } from '../common/ui'
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

export default function MessageFeed({ messages, filter, onFilter, search, onSearch, privacyMode, onOpen, loading, error }: Props) {
  const tabs: { key: FeedFilter; label: string }[] = [
    ...(privacyMode ? [] : [{ key: 'all' as const, label: 'All' }]),
    { key: 'flagged', label: 'Flagged' },
    { key: 'review', label: 'Needs review' },
  ]
  return (
    <section className="bg-white rounded-2xl shadow-sm flex flex-col min-h-0">
      <div className="p-4 border-b border-soft-peach-100 flex flex-wrap items-center gap-3">
        <FunnelIcon size={16} weight="bold" className="text-ink-black-400" aria-hidden />
        <div className="flex gap-1" role="tablist" aria-label="Message filter">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={filter === t.key}
              onClick={() => onFilter(t.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-none cursor-pointer ${filter === t.key ? 'bg-spicy-orange-500 text-white' : 'bg-soft-peach-50 text-ink-black-600 hover:bg-soft-peach-100'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <label className="ml-auto relative flex items-center">
          <span className="sr-only">Search messages</span>
          <MagnifyingGlassIcon size={14} className="absolute left-3 text-ink-black-300" aria-hidden />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search messages…"
            className="bg-soft-peach-50 border border-rust-brown-100 rounded-xl pl-8 pr-3 py-1.5 text-sm outline-none focus:border-rust-brown-300 w-52"
          />
        </label>
      </div>
      {privacyMode && (
        <p className="px-4 py-2 text-xs text-amber-700 bg-amber-50 m-0 flex items-center gap-1.5">
          <EyeSlashIcon size={14} weight="bold" aria-hidden /> Privacy mode: only flagged messages are shown.
        </p>
      )}
      <ul className="list-none m-0 p-0 overflow-y-auto max-h-[36rem] divide-y divide-soft-peach-100">
        {loading && <li className="p-6 text-center text-sm text-ink-black-300">Loading…</li>}
        {error && <li className="p-6 text-center text-sm text-red-500">Couldn't load messages.</li>}
        {!loading && messages.length === 0 && <li className="p-6 text-center text-sm text-ink-black-300">Nothing here.</li>}
        {messages.slice(0, 200).map((m) => {
          const status = messageStatus(m)
          return (
            <li key={m.id ?? m.message_id}>
              <button onClick={() => onOpen(m)} className="w-full text-left bg-transparent hover:bg-soft-peach-50 border-none cursor-pointer px-4 py-3 flex gap-3">
                <Avatar src={m.is_sent ? null : m.profile_picture_flagged ? null : m.profile_picture} size={32} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-ink-black-800">{m.is_sent ? 'Your child' : m.username}</span>
                    <span className="text-[0.65rem] text-ink-black-400">
                      {displayPlatform(m.platform)} · {m.channel_name}
                    </span>
                    {status !== 'safe' && <StatusBadge status={status} />}
                    {!!m.pii?.length && <span className="text-[0.65rem] font-bold rounded-md px-1.5 py-0.5 bg-amber-50 text-amber-700">Personal info</span>}
                    <span className="ml-auto text-[0.65rem] text-ink-black-300">{formatDateTime(m.timestamp?.toMillis?.() ?? 0)}</span>
                  </div>
                  <p className="text-sm text-ink-black-600 m-0 mt-0.5 truncate">
                    {m.message || (m.attachments?.length ? <span className="inline-flex items-center gap-1 text-ink-black-400"><ImageIcon size={12} aria-hidden /> attachment</span> : '')}
                  </p>
                  <div className="mt-1"><CategoryTags categories={m.moderation?.categories} /></div>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
