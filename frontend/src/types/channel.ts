import type { Icon } from '@phosphor-icons/react'
import {
  DiscordLogoIcon,
  UserIcon,
  ChatCircleIcon,
  InstagramLogoIcon,
} from '@phosphor-icons/react'
import { messageStatus, type FirestoreMessage } from './message'

/** Derived sidebar channel / DM entry */
export interface Channel {
  /** Composite key "platform:channel_id" (same as the backend thread id) */
  key: string
  channel_id: string
  channel_name: string
  platform: string
  icon: Icon
  lastMessage: string
  unread: number
  /** Profile picture URL from incoming messages in this channel */
  profilePicture: string
  /** Whether this channel has messages from 2+ distinct senders (group chat) */
  isGroupChat: boolean
  /** Unique profile picture URLs of non-child senders in this channel */
  profilePictures: string[]
  /** Contact ids of the other people in this channel */
  contactIds: string[]
  /** Timestamp (ms) of the most recent message in this channel */
  lastTimestamp: number
}

export function platformIcon(platform: string, channelName = ''): Icon {
  switch (platform) {
    case 'discord':
      return DiscordLogoIcon
    case 'instagram':
      return InstagramLogoIcon
    default:
      return channelName === 'DM' ? UserIcon : ChatCircleIcon
  }
}

function deriveChannelName(message: FirestoreMessage): string {
  if (message.platform === 'discord' && message.channel_name === 'DM') {
    return message.username + ' (DM)'
  }
  return message.channel_name
}

/** Capitalise the first letter of a platform name for display */
export function displayPlatform(platform: string): string {
  return platform.charAt(0).toUpperCase() + platform.slice(1)
}

/** One-line preview for a message that never leaks hidden content. */
export function previewText(msg: FirestoreMessage): string {
  const status = messageStatus(msg)
  if (status === 'censored') return '⚠️ Message hidden'
  if (status === 'needs_review') return '⏳ Waiting for a check'
  if (status === 'blocked') return '🚫 Blocked'
  const text = status === 'masked' ? msg.masked_content ?? '' : msg.message
  if (text) return text
  if (msg.attachments?.length) return '📎 Attachment'
  return ''
}

// ── Read markers (localStorage) ────────────────────────────────────

const READ_MARKERS_KEY = 'safeguard_read_markers'

function getReadMarkers(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(READ_MARKERS_KEY) || '{}')
  } catch {
    return {}
  }
}

export function markChannelRead(channelKey: string) {
  const markers = getReadMarkers()
  markers[channelKey] = Date.now()
  localStorage.setItem(READ_MARKERS_KEY, JSON.stringify(markers))
}

/**
 * Build a de-duplicated channel list from messages (assumed sorted oldest first).
 * Groups by platform + channel_id so identical IDs on different platforms stay separate.
 */
export function deriveChannels(messages: FirestoreMessage[]): Channel[] {
  const map = new Map<string, Channel>()
  const usernameSets = new Map<string, Set<string>>()
  const userPfpMap = new Map<string, Map<string, string>>()
  const contactSets = new Map<string, Set<string>>()
  const readMarkers = getReadMarkers()

  for (const msg of messages) {
    const key = `${msg.platform}:${msg.channel_id}`
    const msgTs = msg.timestamp?.toMillis?.() ?? 0
    const isUnread = !msg.is_sent && msgTs > (readMarkers[key] ?? 0)

    let channel = map.get(key)
    if (!channel) {
      channel = {
        key,
        channel_id: msg.channel_id,
        channel_name: deriveChannelName(msg),
        platform: msg.platform,
        icon: platformIcon(msg.platform, msg.channel_name),
        lastMessage: '',
        unread: 0,
        profilePicture: '',
        isGroupChat: false,
        profilePictures: [],
        contactIds: [],
        lastTimestamp: 0,
      }
      map.set(key, channel)
      usernameSets.set(key, new Set())
      userPfpMap.set(key, new Map())
      contactSets.set(key, new Set())
    }

    channel.lastMessage = previewText(msg)
    if (isUnread) channel.unread += 1
    if (msgTs > channel.lastTimestamp) channel.lastTimestamp = msgTs
    if (!msg.is_sent) {
      if (msg.username) usernameSets.get(key)!.add(msg.username)
      if (msg.contact_id) contactSets.get(key)!.add(msg.contact_id)
      if (msg.profile_picture && !msg.profile_picture_flagged) {
        channel.profilePicture = msg.profile_picture
        userPfpMap.get(key)!.set(msg.username, msg.profile_picture)
      }
      channel.channel_name = deriveChannelName(msg)
    }
  }

  for (const [key, channel] of map) {
    const usernames = Array.from(usernameSets.get(key) ?? [])
    const pfpMap = userPfpMap.get(key)!
    channel.profilePictures = usernames.map((u) => pfpMap.get(u)).filter((url): url is string => !!url)
    channel.isGroupChat = usernames.length >= 2
    channel.contactIds = Array.from(contactSets.get(key) ?? [])
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.unread > 0 && b.unread === 0) return -1
    if (a.unread === 0 && b.unread > 0) return 1
    return b.lastTimestamp - a.lastTimestamp
  })
}
