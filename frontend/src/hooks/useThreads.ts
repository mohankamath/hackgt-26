import { useMemo } from 'react'
import { collection, query } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { ThreadRisk } from '../types/safety'
import { useCollection } from './useCollection'

const RISK_ORDER = { none: 0, low: 1, medium: 2, high: 3 } as const

/** Real-time `threads` collection (AI risk analysis per conversation), riskiest first. */
export function useThreads() {
  const { items, loading, error } = useCollection<ThreadRisk>(() => query(collection(db, 'threads')))
  const threads = useMemo(
    () =>
      [...items].sort(
        (a, b) =>
          RISK_ORDER[b.risk_level ?? 'none'] - RISK_ORDER[a.risk_level ?? 'none'] ||
          (b.risk_score ?? 0) - (a.risk_score ?? 0),
      ),
    [items],
  )
  const byId = useMemo(() => new Map(items.map((t) => [t.id, t])), [items])
  return { threads, byId, loading, error }
}
