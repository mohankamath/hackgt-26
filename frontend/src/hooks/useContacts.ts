import { useCallback, useMemo } from 'react'
import { collection, query } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { setContactStatus, vetContact } from '../lib/api'
import type { Contact, ContactStatus } from '../types/safety'
import { useCollection } from './useCollection'

/**
 * Real-time `contacts` collection (replaces approved_users / blocked_users).
 * Status changes go through the backend, which also flips message visibility.
 */
export function useContacts() {
  const { items, loading, error } = useCollection<Contact>(() => query(collection(db, 'contacts')))

  const byId = useMemo(() => new Map(items.map((c) => [c.id, c])), [items])
  const pending = useMemo(
    () =>
      items
        .filter((c) => c.status === 'pending')
        .sort((a, b) => (b.last_message_at?.toMillis?.() ?? 0) - (a.last_message_at?.toMillis?.() ?? 0)),
    [items],
  )

  const statusOf = useCallback((contactId?: string | null): ContactStatus | undefined => (contactId ? byId.get(contactId)?.status : undefined), [byId])

  const setStatus = useCallback((contactId: string, status: ContactStatus) => setContactStatus(contactId, status), [])
  const revet = useCallback((contactId: string) => vetContact(contactId), [])

  return { contacts: items, byId, pending, loading, error, statusOf, setStatus, revet }
}
