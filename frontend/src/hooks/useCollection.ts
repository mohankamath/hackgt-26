import { useEffect, useState } from 'react'
import { onSnapshot, type Query, type DocumentData } from 'firebase/firestore'

/** Generic real-time list subscription: each doc becomes `{ id, ...data }`. */
export function useCollection<T extends { id: string }>(makeQuery: () => Query<DocumentData>, deps: unknown[] = []) {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const unsub = onSnapshot(
      makeQuery(),
      (snap) => {
        setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T))
        setLoading(false)
      },
      (err) => {
        console.error('Firestore subscription error:', err)
        setError(err)
        setLoading(false)
      },
    )
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { items, loading, error }
}
