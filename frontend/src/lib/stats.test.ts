import { describe, expect, it } from 'vitest'
import { activityByDay, categoryBreakdown, newToastAlerts, overviewStats, reviewFeed, sortAlerts } from './stats'
import { deriveChannels, previewText } from '../types/channel'
import { isVisibleToChild, messageStatus } from '../types/message'
import type { Alert } from '../types/safety'
import { fakeTs, msg } from '../test/factories'

const NOW = new Date(2026, 8, 26, 15, 0)
const DAY = 86_400_000

describe('overviewStats', () => {
  it('counts statuses of received messages only', () => {
    const s = overviewStats([
      msg(),
      msg({ status: 'masked' }),
      msg({ status: 'censored', censored: true }),
      msg({ status: 'needs_review' }),
      msg({ is_sent: true }),
    ])
    expect(s).toMatchObject({ received: 4, sent: 1, safe: 1, masked: 1, censored: 1, needsReview: 1, safeRate: 25 })
  })

  it('treats legacy docs without status via censored flag', () => {
    expect(messageStatus({ censored: true })).toBe('censored')
    expect(messageStatus({ censored: false })).toBe('safe')
  })
})

describe('activityByDay', () => {
  it('buckets the last 7 days by status', () => {
    const days = activityByDay(
      [
        msg({ at: NOW.getTime() }),
        msg({ at: NOW.getTime(), status: 'censored' }),
        msg({ at: NOW.getTime() - DAY, status: 'masked' }),
        msg({ at: NOW.getTime() - 10 * DAY }), // outside window
        msg({ at: NOW.getTime(), is_sent: true }),
      ],
      NOW,
    )
    expect(days).toHaveLength(7)
    expect(days[6]).toMatchObject({ safe: 1, censored: 1, sent: 1 })
    expect(days[5]).toMatchObject({ masked: 1 })
    expect(days.slice(0, 5).every((d) => d.safe + d.masked + d.censored === 0)).toBe(true)
  })
})

describe('categoryBreakdown', () => {
  it('counts each category once per message and skips grooming hints', () => {
    const cat = (category: string, severity: 'low' | 'high' = 'high') => ({ category, label: category, score: 1, severity })
    const out = categoryBreakdown([
      msg({ moderation: { categories: [cat('sexual'), cat('sexual')], scores: {}, reasons: [] } }),
      msg({ moderation: { categories: [cat('profanity', 'low'), cat('grooming_hint')], scores: {}, reasons: [] } }),
      msg({ moderation: { categories: [cat('sexual')], scores: {}, reasons: [] } }),
    ])
    expect(out.map((c) => [c.category, c.count])).toEqual([
      ['sexual', 2],
      ['profanity', 1],
    ])
  })
})

describe('alerts', () => {
  const alert = (id: string, severity: Alert['severity'], read: boolean, at: number): Alert => ({
    id, severity, read, type: 'thread_risk', title: id, body: '', created_at: fakeTs(at),
  })

  it('sorts unread first, then severity, then newest', () => {
    const sorted = sortAlerts([alert('a', 'low', false, 3), alert('b', 'high', true, 5), alert('c', 'high', false, 1), alert('d', 'low', false, 4)])
    expect(sorted.map((a) => a.id)).toEqual(['c', 'd', 'a', 'b'])
  })

  it('only toasts new unread medium+ alerts', () => {
    const out = newToastAlerts([alert('old', 'high', false, 1), alert('low', 'low', false, 10), alert('new', 'medium', false, 10), alert('read', 'high', true, 10)], 5)
    expect(out.map((a) => a.id)).toEqual(['new'])
  })
})

describe('reviewFeed', () => {
  const feed = [msg({ message: 'hi there' }), msg({ status: 'censored', message: 'bad' }), msg({ status: 'needs_review', message: 'img' })]

  it('privacy mode shows only flagged items', () => {
    expect(reviewFeed(feed, { privacyMode: true, filter: 'all', search: '' })).toHaveLength(2)
  })

  it('review filter shows only needs_review', () => {
    expect(reviewFeed(feed, { privacyMode: false, filter: 'review', search: '' }).map((m) => m.message)).toEqual(['img'])
  })

  it('searches text and names', () => {
    expect(reviewFeed(feed, { privacyMode: false, filter: 'all', search: 'THERE' })).toHaveLength(1)
  })
})

describe('visibility + channels', () => {
  it('hides pending, blocked, and legacy docs from the child', () => {
    expect(isVisibleToChild(msg())).toBe(true)
    expect(isVisibleToChild(msg({ visible_to_child: false }))).toBe(false)
    expect(isVisibleToChild(msg({ status: 'blocked', visible_to_child: true }))).toBe(false)
    expect(isVisibleToChild(msg({ visible_to_child: undefined }))).toBe(false)
    expect(isVisibleToChild(msg({ is_sent: true, visible_to_child: false }))).toBe(true)
  })

  it('previews never leak hidden text', () => {
    expect(previewText(msg({ status: 'censored', message: 'secret bad words' }))).toBe('⚠️ Message hidden')
    expect(previewText(msg({ status: 'masked', message: 'this is shit', masked_content: 'this is •••' }))).toBe('this is •••')
  })

  it('groups by platform + channel and detects group chats', () => {
    localStorage.clear()
    const channels = deriveChannels([
      msg({ at: 1, username: 'sam', contact_id: 'discord:1' }),
      msg({ at: 2, username: 'alex', contact_id: 'discord:2', user_id: '2' }),
      msg({ at: 3, platform: 'instagram', channel_id: '555', username: 'ig' }),
      msg({ at: 4, profile_picture: 'https://bad.png', profile_picture_flagged: true, username: 'sam', contact_id: 'discord:1' }),
    ])
    expect(channels).toHaveLength(2)
    const discord = channels.find((c) => c.platform === 'discord')!
    expect(discord.isGroupChat).toBe(true)
    expect(discord.contactIds.sort()).toEqual(['discord:1', 'discord:2'])
    expect(discord.profilePictures).not.toContain('https://bad.png')
  })
})
