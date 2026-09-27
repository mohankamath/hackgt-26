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
  const childName = settings.childName || 'Me'
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
    <div className="flex h-screen bg-soft-peach-50">
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

      <main className="flex-1 flex flex-col min-w-0">
        {selectedChannel ? (
          <>
            <header className="bg-white px-5 py-3 flex items-center gap-3 border-b border-rust-brown-100">
              <button className="hidden max-md:flex bg-transparent border-none cursor-pointer p-1 text-ink-black-700" aria-label="Open chats" onClick={() => setSidebarOpen(true)}>
                <ListIcon size={24} weight="bold" />
              </button>
              <ChannelAvatar channel={selectedChannel} size={40} />
              <div className="flex flex-col min-w-0">
                <h3 className="text-lg font-bold text-ink-black-800 leading-tight truncate">{selectedChannel.channel_name}</h3>
                <span className="text-xs text-ink-black-400">
                  {displayPlatform(selectedChannel.platform)}
                  {selectedChannel.isGroupChat && ` · ${selectedChannel.profilePictures.length + 1} members`}
                </span>
              </div>
            </header>

            {showTip && (
              <div className="bg-sky-50 border-b border-sky-200 px-5 py-2.5 flex items-start gap-2" role="note">
                <LightbulbIcon size={18} weight="fill" className="text-sky-500 shrink-0 mt-0.5" aria-hidden />
                <p className="text-sm text-sky-900 m-0">{thread!.child_tip}</p>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-2" aria-live="polite">
              {currentMessages.map((msg) => (
                <ChatBubble key={msg.id ?? msg.message_id} msg={msg} onImageClick={setLightboxUrl} childName={childName} childAvatar={childAvatar} />
              ))}
              <div ref={messagesEndRef} />
            </div>

            <MessageInput channelId={selectedChannel.channel_id} platform={selectedChannel.platform} disabledReason={disabledReason} />
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-ink-black-300 gap-2">
            <button className="hidden max-md:flex bg-transparent border-none cursor-pointer p-1 text-ink-black-700 absolute top-4 left-4" aria-label="Open chats" onClick={() => setSidebarOpen(true)}>
              <ListIcon size={24} weight="bold" />
            </button>
            <div className="animate-bounce-slow">
              <ChatCircleDotsIcon size={64} weight="duotone" className="text-carrot-orange-400" aria-hidden />
            </div>
            <h2 className="text-2xl font-bold text-ink-black-500">Hi {childName}! Pick a chat.</h2>
            <p>Select a conversation from the sidebar to start chatting.</p>
          </div>
        )}
      </main>

      {lightboxUrl && <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </div>
  )
}

export default ChildChat
