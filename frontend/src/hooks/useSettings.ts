import { useCallback, useEffect, useState } from 'react'
import { arrayRemove, arrayUnion, doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { DEFAULT_SETTINGS, type AppSettings } from '../types/safety'

const SETTINGS_DOC = doc(db, 'settings', 'app')

/**
 * Real-time `settings/app`. The backend reads the same doc (cached ~60 s) for
 * sensitivity and custom keywords, so changes apply to new messages within a minute.
 */
export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)

  useEffect(
    () =>
      onSnapshot(
        SETTINGS_DOC,
        (snap) => {
          setSettings({ ...DEFAULT_SETTINGS, ...(snap.exists() ? snap.data() : {}) } as AppSettings)
          setLoading(false)
        },
        () => setLoading(false),
      ),
    [],
  )

  const updateSettings = useCallback((patch: Partial<AppSettings>) => setDoc(SETTINGS_DOC, patch, { merge: true }), [])

  const addKeyword = useCallback(async (word: string) => {
    const trimmed = word.trim().toLowerCase()
    if (trimmed) await setDoc(SETTINGS_DOC, { customKeywords: arrayUnion(trimmed) }, { merge: true })
  }, [])

  const removeKeyword = useCallback(
    (word: string) => setDoc(SETTINGS_DOC, { customKeywords: arrayRemove(word) }, { merge: true }),
    [],
  )

  return { settings, loading, updateSettings, addKeyword, removeKeyword }
}
