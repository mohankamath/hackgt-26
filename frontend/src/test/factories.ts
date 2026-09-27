import type { Timestamp } from 'firebase/firestore'
import type { FirestoreMessage } from '../types/message'

/** Minimal Timestamp stand-in (only the methods the app uses). */
export function fakeTs(ms: number): Timestamp {
  return { toMillis: () => ms, toDate: () => new Date(ms) } as unknown as Timestamp
}

let n = 0

export function msg(overrides: Partial<FirestoreMessage> & { at?: number } = {}): FirestoreMessage {
  n += 1
  const { at, ...rest } = overrides
  return {
    id: `discord:${n}`,
    message_id: String(n),
    platform: 'discord',
    user_id: '99',
    username: 'sam',
    contact_id: 'discord:99',
    channel_id: '555',
    channel_name: 'sam',
    server_id: 'DM',
    message: 'hello',
    status: 'safe',
    censored: false,
    flagged_words: [],
    profile_picture: 'https://cdn.example/sam.png',
    visible_to_child: true,
    timestamp: fakeTs(at ?? Date.now()),
    ...rest,
  }
}
