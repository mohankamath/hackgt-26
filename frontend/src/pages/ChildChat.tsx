import { useEffect, useMemo, useRef, useState } from 'react'
import { ChatCircleDotsIcon, ListIcon, LightbulbIcon } from '@phosphor-icons/react'
import { useMessages } from '../hooks/useMessages'
import { useContacts } from '../hooks/useContacts'
import { useThreads } from '../hooks/useThreads'
import { useSettings } from '../hooks/useSettings'
import type { Channel } from '../types/channel'
import { deriveChannels, displayPlatform, markChannelRead } from '../types/channel'
import { isVisibleToChild } from '../types/message'
import ChatSidebar, { ChannelAvatar } from '../components/chat/ChatSidebar'
import ChatBubble from '../components/chat/ChatBubble'
import MessageInput from '../components/chat/MessageInput'
import ImageLightbox from '../components/chat/ImageLightbox'
import happyDog from '../assets/happydog.jpg'

function ChildChat() {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const { messages, loading, error } = useMessages()
  const { pending, statusOf } = useContacts()
  const { byId: threadsById } = useThreads()
  const { settings } = useSettings()
  // "Your child" is the parent-facing default; the kid sees a friendlier fallback.
  const childName = settings.childName && settings.childName !== 'Your child' ? settings.childName : 'friend'
  const childAvatar = settings.childAvatar || happyDog

  // Visibility is decided by the backend (pending / blocked senders are never visible).
  const visible = useMemo(() => messages.filter(isVisibleToChild), [messages])
  const channels = useMemo(() => deriveChannels(visible), [visible])
  const selectedChannel = channels.find((c) => c.key === selectedKey) ?? null

  const currentMessages = useMemo(
    () => (selectedChannel ? visible.filter((m) => m.platform === selectedChannel.platform && m.channel_id === selectedChannel.channel_id) : []),
    [visible, selectedChannel],
  )

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentMessages.length])

  const handleSelectChannel = (channel: Channel) => {
    markChannelRead(channel.key)
    setSelectedKey(channel.key)
    setSidebarOpen(false)
  }

  const thread = selectedChannel ? threadsById.get(selectedChannel.key) : undefined
  const showTip = thread?.child_tip && (thread.risk_level === 'medium' || thread.risk_level === 'high')

  const statuses = selectedChannel?.contactIds.map(statusOf) ?? []
  const disabledReason = statuses.includes('blocked')
    ? 'You can’t message this person right now.'
    : statuses.length > 0 && !statuses.some((s) => s === 'approved' || s === 'watch')
      ? 'Waiting for a parent to approve this chat.'
      : null

  return (
    <div className="flex h-screen bg-bg">
      <ChatSidebar
        channels={channels}
        selectedChannel={selectedChannel}
        loading={loading}
        error={error}
        open={sidebarOpen}
        onSelectChannel={handleSelectChannel}
        pendingNames={pending.map((c) => c.username)}
        childName={childName}
        childAvatar={childAvatar}
      />

      <main className="flex-1 flex flex-col min-w-0 bg-aurora relative">
        <div className="absolute inset-0 bg-grid pointer-events-none" aria-hidden />
        {selectedChannel ? (
          <>
            <header className="relative z-10 h-16 px-5 flex items-center gap-3 border-b border-line bg-bg/70 backdrop-blur-xl">
              <button className="hidden max-md:flex bg-transparent border-none p-1 text-fg-soft" aria-label="Open chats" onClick={() => setSidebarOpen(true)}>
                <ListIcon size={22} />
              </button>
              <ChannelAvatar channel={selectedChannel} size={38} />
              <div className="flex flex-col min-w-0">
                <h2 className="text-base font-semibold text-fg m-0 truncate">{selectedChannel.channel_name}</h2>
                <span className="text-xs text-muted">
                  {displayPlatform(selectedChannel.platform)}
                  {selectedChannel.isGroupChat && ` · ${selectedChannel.profilePictures.length + 1} members`}
                </span>
              </div>
            </header>

            {showTip && (
              <div className="relative z-10 mx-5 mt-4 rounded-xl bg-accent-2/10 ring-1 ring-accent-2/25 px-4 py-3 flex items-start gap-2.5 animate-rise" role="note">
                <LightbulbIcon size={18} weight="fill" className="text-accent-2 shrink-0 mt-0.5" aria-hidden />
                <p className="text-sm text-fg-soft m-0">{thread!.child_tip}</p>
              </div>
            )}

            <div className="relative z-10 flex-1 overflow-y-auto px-5 py-6 flex flex-col gap-4" aria-live="polite">
              {currentMessages.map((msg, i) => {
                const prev = currentMessages[i - 1]
                const grouped =
                  !!prev &&
                  !!prev.is_sent === !!msg.is_sent &&
                  prev.user_id === msg.user_id &&
                  (msg.timestamp?.toMillis?.() ?? 0) - (prev.timestamp?.toMillis?.() ?? 0) < 5 * 60_000
                return (
                  <ChatBubble key={msg.id ?? msg.message_id} msg={msg} onImageClick={setLightboxUrl} childName={childName} childAvatar={childAvatar} grouped={grouped} />
                )
              })}
              <div ref={messagesEndRef} />
            </div>

            <div className="relative z-10">
              <MessageInput channelId={selectedChannel.channel_id} platform={selectedChannel.platform} disabledReason={disabledReason} />
            </div>
          </>
        ) : (
          <div className="relative z-10 flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
            <button className="hidden max-md:flex bg-transparent border-none p-1 text-fg-soft absolute top-4 left-4" aria-label="Open chats" onClick={() => setSidebarOpen(true)}>
              <ListIcon size={22} />
            </button>
            <div className="animate-float w-20 h-20 rounded-3xl bg-surface-2 ring-1 ring-line flex items-center justify-center shadow-glow">
              <ChatCircleDotsIcon size={40} weight="duotone" className="text-accent" aria-hidden />
            </div>
            <h2 className="text-3xl font-bold m-0 mt-3">
              Hi <span className="text-gradient">{childName}</span>!
            </h2>
            <p className="text-muted m-0">Pick a chat on the left to start talking.</p>
          </div>
        )}
      </main>

      {lightboxUrl && <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </div>
  )
}

export default ChildChat
