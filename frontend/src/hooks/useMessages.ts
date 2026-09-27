import { useEffect, useRef, useState } from 'react'
import {
  collection,
  query,
  orderBy,
  limit as limitTo,
  onSnapshot,
  type QuerySnapshot,
  type DocumentData,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { FirestoreMessage } from '../types/message'

interface UseMessagesOptions {
  /** Max docs per collection (most recent). Keeps the listener cheap as history grows. */
  limit?: number
}

/** Merge incoming + sent, de-duplicate by doc id, sort oldest first. */
export function mergeAndSort(a: FirestoreMessage[], b: FirestoreMessage[]): FirestoreMessage[] {
  const map = new Map<string, FirestoreMessage>()
  for (const msg of [...a, ...b]) map.set(msg.id ?? `${msg.platform}:${msg.message_id}`, msg)
  return Array.from(map.values()).sort(
    (x, y) => (x.timestamp?.toMillis?.() ?? 0) - (y.timestamp?.toMillis?.() ?? 0),
  )
}

/**
 * Real-time subscription to the most recent `messages` and `sent_messages`.
 * Sent messages are tagged `is_sent = true`.
 */
export function useMessages({ limit = 500 }: UseMessagesOptions = {}) {
  const [messages, setMessages] = useState<FirestoreMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const incomingRef = useRef<FirestoreMessage[]>([])
  const sentRef = useRef<FirestoreMessage[]>([])

  useEffect(() => {
    let loaded = 0
    const onLoaded = () => {
      loaded += 1
      if (loaded >= 2) setLoading(false)
    }
    const toList = (snap: QuerySnapshot<DocumentData>, isSent: boolean): FirestoreMessage[] =>
      snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        collection: isSent ? 'sent_messages' : 'messages',
        is_sent: isSent,
      })) as FirestoreMessage[]

    const subscribe = (name: 'messages' | 'sent_messages', ref: typeof incomingRef) =>
      onSnapshot(
        query(collection(db, name), orderBy('timestamp', 'desc'), limitTo(limit)),
        (snap) => {
          ref.current = toList(snap, name === 'sent_messages')
          setMessages(mergeAndSort(incomingRef.current, sentRef.current))
          onLoaded()
        },
        (err) => {
          console.error(`Firestore ${name} subscription error:`, err)
          setError(err)
          onLoaded()
        },
      )

    const unsubIn = subscribe('messages', incomingRef)
    const unsubSent = subscribe('sent_messages', sentRef)
    return () => {
      unsubIn()
      unsubSent()
    }
  }, [limit])

  return { messages, loading, error }
}
