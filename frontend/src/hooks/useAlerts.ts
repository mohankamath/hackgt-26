import { useCallback, useMemo } from 'react'
import { collection, doc, limit, orderBy, query, updateDoc, writeBatch } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { sortAlerts } from '../lib/stats'
import type { Alert } from '../types/safety'
import { useCollection } from './useCollection'

/** Live parent alerts (newest 50). */
export function useAlerts() {
  const { items, loading, error } = useCollection<Alert>(() =>
    query(collection(db, 'alerts'), orderBy('created_at', 'desc'), limit(50)),
  )
  const alerts = useMemo(() => sortAlerts(items), [items])
  const unreadCount = useMemo(() => alerts.filter((a) => !a.read).length, [alerts])

  const markRead = useCallback((id: string) => updateDoc(doc(db, 'alerts', id), { read: true }), [])
  const markAllRead = useCallback(async () => {
    const batch = writeBatch(db)
    alerts.filter((a) => !a.read).forEach((a) => batch.update(doc(db, 'alerts', a.id), { read: true }))
    await batch.commit()
  }, [alerts])

  return { alerts, unreadCount, loading, error, markRead, markAllRead }
}
