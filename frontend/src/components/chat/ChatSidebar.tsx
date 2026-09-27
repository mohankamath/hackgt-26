import { useNavigate } from 'react-router-dom'
import { SignOutIcon, HourglassMediumIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import type { Channel } from '../../types/channel'
import { Avatar, Logo } from '../common/ui'

interface ChatSidebarProps {
  channels: Channel[]
  selectedChannel: Channel | null
  loading: boolean
  error: Error | null
  open: boolean
  onSelectChannel: (channel: Channel) => void
  /** Usernames of new contacts waiting for a parent (no message content is shown). */
  pendingNames: string[]
  childName: string
  childAvatar?: string | null
}

const PLATFORM_DOT: Record<string, string> = {
  discord: 'bg-[#5865F2]',
  instagram: 'bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af]',
}

export function ChannelAvatar({ channel, size = 44 }: { channel: Channel; size?: number }) {
  const IconCmp = channel.icon
  if (channel.isGroupChat) {
    const small = Math.round(size * 0.68)
    return (
      <span className="relative block shrink-0" style={{ width: size, height: size }}>
        <Avatar src={channel.profilePictures[0]} size={small} className="absolute top-0 left-0 z-10 ring-2 ring-surface" />
        <Avatar src={channel.profilePictures[1]} size={small} className="absolute bottom-0 right-0 ring-2 ring-surface" />
      </span>
    )
  }
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <Avatar src={channel.profilePicture} size={size} />
      <span className={`absolute -bottom-0.5 -right-0.5 w-[18px] h-[18px] flex items-center justify-center rounded-full ring-2 ring-surface text-white ${PLATFORM_DOT[channel.platform] ?? 'bg-surface-3'}`}>
        <IconCmp size={10} weight="fill" aria-hidden />
      </span>
    </span>
  )
}

export default function ChatSidebar({ channels, selectedChannel, loading, error, open, onSelectChannel, pendingNames, childName, childAvatar }: ChatSidebarProps) {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const [q, setQ] = useState('')
  const shown = q.trim() ? channels.filter((c) => c.channel_name.toLowerCase().includes(q.trim().toLowerCase())) : channels

  return (
    <aside
      className={`w-[320px] bg-surface border-r border-line flex flex-col shrink-0
        max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-20 max-md:shadow-2xl max-md:transition-transform max-md:duration-300
        ${open ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'}`}
    >
      <div className="px-4 pt-4 pb-3 flex items-center gap-3">
        <Avatar src={childAvatar} size={40} className="ring-2 ring-accent/60" />
        <div className="min-w-0 flex-1">
          <p className="text-[0.7rem] text-muted m-0">Hey there</p>
          <p className="font-display font-semibold text-fg m-0 truncate">{childName}</p>
        </div>
        <button
          onClick={() => { logout(); navigate('/') }}
          aria-label="Log out"
          className="w-9 h-9 rounded-xl bg-surface-2 ring-1 ring-line border-none text-muted hover:text-fg flex items-center justify-center transition-colors"
        >
          <SignOutIcon size={17} />
        </button>
      </div>

      <div className="px-4 pb-3">
        <label className="relative flex items-center">
          <span className="sr-only">Search chats</span>
          <MagnifyingGlassIcon size={15} className="absolute left-3 text-subtle" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" className="field w-full pl-9 pr-3 py-2 text-sm" />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {pendingNames.length > 0 && (
          <div className="mx-2 mb-2 rounded-xl bg-ai/10 ring-1 ring-ai/25 px-3.5 py-3 flex items-start gap-2.5" role="status">
            <HourglassMediumIcon size={18} weight="duotone" className="text-ai shrink-0 mt-0.5" aria-hidden />
            <p className="text-xs text-fg-soft m-0 leading-relaxed">
              <span className="font-semibold text-fg">{pendingNames.length === 1 ? pendingNames[0] : `${pendingNames.length} people`}</span>{' '}
              {pendingNames.length === 1 ? 'wants' : 'want'} to chat. A parent will check first, then they'll show up here.
            </p>
          </div>
        )}
        <p className="px-3 pt-1 pb-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-subtle m-0">Messages</p>
        {loading && <p className="text-center text-muted py-4 text-sm">Loading chats…</p>}
        {error && <p className="text-center text-danger py-4 text-sm">Couldn't load messages.</p>}
        {!loading && !error && shown.length === 0 && <p className="text-center text-subtle py-6 text-sm">No chats yet.</p>}
        {shown.map((channel) => {
          const active = selectedChannel?.key === channel.key
          return (
            <button
              key={channel.key}
              className={`relative flex items-center gap-3 w-full px-3 py-2.5 border-none rounded-xl text-left transition-colors ${active ? 'bg-surface-3' : 'bg-transparent hover:bg-surface-2'}`}
              onClick={() => onSelectChannel(channel)}
            >
              {active && <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full bg-accent" aria-hidden />}
              <ChannelAvatar channel={channel} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm truncate ${channel.unread ? 'font-semibold text-fg' : 'font-medium text-fg-soft'}`}>{channel.channel_name}</span>
                  <span className="ml-auto text-[0.65rem] text-subtle shrink-0">
                    {channel.lastTimestamp ? new Date(channel.lastTimestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs truncate ${channel.unread ? 'text-fg-soft' : 'text-muted'}`}>{channel.lastMessage}</span>
                  {channel.unread > 0 && (
                    <span className="ml-auto bg-accent text-abyss text-[0.65rem] font-bold min-w-5 h-5 rounded-full flex items-center justify-center px-1.5 shrink-0" aria-label={`${channel.unread} unread`}>
                      {channel.unread}
                    </span>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="px-4 py-3 border-t border-line flex items-center gap-2 text-[0.7rem] text-subtle">
        <Logo size={16} /> Protected by Screened
      </div>
    </aside>
  )
}
