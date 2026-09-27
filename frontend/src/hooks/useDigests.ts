import { collection, limit, orderBy, query } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { Digest } from '../types/safety'
import { useCollection } from './useCollection'

/** Most recent AI parent digests. */
export function useDigests() {
  const { items, loading, error } = useCollection<Digest>(() =>
    query(collection(db, 'digests'), orderBy('created_at', 'desc'), limit(5)),
  )
  return { digests: items, latest: items[0] ?? null, loading, error }
}
