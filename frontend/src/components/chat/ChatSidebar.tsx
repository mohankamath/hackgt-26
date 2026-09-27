import { useNavigate } from 'react-router-dom'
import { SignOutIcon, ChatCircleDotsIcon, HourglassMediumIcon } from '@phosphor-icons/react'
import { useAuth } from '../../hooks/useAuth'
import type { Channel } from '../../types/channel'
import { Avatar } from '../common/ui'

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

const PLATFORM_CLS: Record<string, string> = {
  discord: 'text-indigo-600 bg-indigo-50',
  instagram: 'text-pink-600 bg-pink-50',
}

export function ChannelAvatar({ channel, size = 48 }: { channel: Channel; size?: number }) {
  const IconCmp = channel.icon
  if (channel.isGroupChat) {
    const small = Math.round(size * 0.66)
    return (
      <span className="relative block shrink-0" style={{ width: size, height: size }}>
        <Avatar src={channel.profilePictures[0]} size={small} className="absolute top-0 left-0 ring-2 ring-white z-10" />
        <Avatar src={channel.profilePictures[1]} size={small} className="absolute bottom-0 right-0 ring-2 ring-white" />
      </span>
    )
  }
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <Avatar src={channel.profilePicture} size={size} />
      <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 flex items-center justify-center bg-white rounded-full shadow-sm">
        <IconCmp size={12} weight="bold" className={channel.platform === 'discord' ? 'text-indigo-500' : 'text-pink-500'} aria-hidden />
      </span>
    </span>
  )
}

export default function ChatSidebar({ channels, selectedChannel, loading, error, open, onSelectChannel, pendingNames, childName, childAvatar }: ChatSidebarProps) {
  const navigate = useNavigate()
  const { logout } = useAuth()

  return (
    <aside
      className={`w-80 bg-white border-r border-rust-brown-100 flex flex-col shrink-0
        max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-20 max-md:shadow-xl max-md:transition-transform max-md:duration-300
        ${open ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'}`}
    >
      <div className="bg-rust-brown-500 text-white px-5 py-4 flex items-center gap-3">
        <button
          onClick={() => { logout(); navigate('/') }}
          aria-label="Log out"
          className="bg-white/25 border-none text-white w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer hover:bg-white/40 transition-colors"
        >
          <SignOutIcon size={18} weight="bold" />
        </button>
        <div className="flex items-center gap-2">
          <ChatCircleDotsIcon size={24} weight="bold" aria-hidden />
          <h2 className="text-xl font-bold">Chats</h2>
        </div>
        <span className="ml-auto flex items-center gap-2 text-sm font-semibold">
          <Avatar src={childAvatar} size={28} className="ring-2 ring-white/60" />
          <span className="max-w-24 truncate">{childName}</span>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {pendingNames.length > 0 && (
          <div className="mx-2 my-2 bg-soft-peach-100 rounded-2xl px-4 py-3 flex items-start gap-2.5" role="status">
            <HourglassMediumIcon size={20} weight="duotone" className="text-carrot-orange-600 shrink-0 mt-0.5" aria-hidden />
            <p className="text-xs text-ink-black-600 m-0">
              <span className="font-bold">{pendingNames.length === 1 ? pendingNames[0] : `${pendingNames.length} people`}</span>{' '}
              {pendingNames.length === 1 ? 'wants' : 'want'} to chat. A parent will check first, then their messages will show up here.
            </p>
          </div>
        )}
        {loading && <p className="text-center text-ink-black-300 py-4 text-sm">Loading chats…</p>}
        {error && <p className="text-center text-red-500 py-4 text-sm">Couldn't load messages.</p>}
        {!loading && !error && channels.length === 0 && (
          <p className="text-center text-ink-black-300 py-6 text-sm">No chats yet.</p>
        )}
        {channels.map((channel) => (
          <button
            key={channel.key}
            className={`flex items-center gap-3 w-full px-4 py-3 border-none rounded-2xl cursor-pointer text-left transition-colors ${
              selectedChannel?.key === channel.key ? 'bg-rust-brown-50' : 'bg-transparent hover:bg-soft-peach-50'
            }`}
            onClick={() => onSelectChannel(channel)}
          >
            <ChannelAvatar channel={channel} />
            <div className="flex-1 min-w-0 flex flex-col">
              <span className="font-bold text-sm text-ink-black-800 truncate">{channel.channel_name}</span>
              <span className="text-xs text-ink-black-400 flex items-center gap-1">
                <span className={`shrink-0 uppercase tracking-wide text-[0.6rem] font-semibold rounded px-1 py-px ${PLATFORM_CLS[channel.platform] ?? 'text-ink-black-400 bg-soft-peach-100'}`}>
                  {channel.platform}
                </span>
                <span className="truncate">{channel.lastMessage}</span>
              </span>
            </div>
            {channel.unread > 0 && (
              <span className="bg-spicy-orange-500 text-white text-[0.7rem] font-bold min-w-[22px] h-[22px] rounded-full flex items-center justify-center px-1.5" aria-label={`${channel.unread} unread`}>
                {channel.unread}
              </span>
            )}
          </button>
        ))}
      </div>
    </aside>
  )
}
