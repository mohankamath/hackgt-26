import { useEffect, useRef, useState } from 'react'
import {
  PaperPlaneRightIcon,
  CircleNotchIcon,
  WarningIcon,
  ShieldWarningIcon,
  InfoIcon,
  LightbulbIcon,
  LockSimpleIcon,
} from '@phosphor-icons/react'
import { previewMessage, sendMessage, type PreviewResult } from '../../lib/api'
import { displayPlatform } from '../../types/channel'

interface MessageInputProps {
  channelId: string
  platform: string
  /** When set, sending is disabled and this reason is shown (pending / blocked contact). */
  disabledReason?: string | null
}

const PREVIEW_DEBOUNCE_MS = 600

export default function MessageInput({ channelId, platform, disabledReason }: MessageInputProps) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [checking, setChecking] = useState(false)
  const previewFor = useRef('')

  // Debounced AI + PII preview of the draft (advisory: the child can still send).
  useEffect(() => {
    const text = draft.trim()
    if (!text) {
      setPreview(null)
      return
    }
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      setChecking(true)
      try {
        const r = await previewMessage(text, ctrl.signal)
        previewFor.current = text
        setPreview(r)
      } catch {
        if (!ctrl.signal.aborted) setPreview(null) // server unreachable: don't block typing
      } finally {
        if (!ctrl.signal.aborted) setChecking(false)
      }
    }, PREVIEW_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [draft])

  const warnings = preview && previewFor.current === draft.trim() ? preview.warnings : []

  const doSend = async () => {
    if (!draft.trim() || sending) return
    setSending(true)
    setSendError(null)
    setShowConfirm(false)
    try {
      await sendMessage(platform, channelId, draft.trim())
      setDraft('')
      setPreview(null)
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send message')
      setTimeout(() => setSendError(null), 5000)
    } finally {
      setSending(false)
    }
  }

  const handleSend = () => {
    if (!draft.trim() || sending) return
    if (warnings.length > 0) {
      setShowConfirm(true)
      return
    }
    doSend()
  }

  if (disabledReason) {
    return (
      <div className="bg-white px-4 py-4 border-t border-rust-brown-100 flex items-center justify-center gap-2 text-sm text-ink-black-400">
        <LockSimpleIcon size={16} weight="bold" aria-hidden />
        {disabledReason}
      </div>
    )
  }

  return (
    <>
      {warnings.length > 0 && !showConfirm && (
        <div role="status" className="bg-amber-50 border-t border-amber-200 px-4 py-2.5 flex items-start gap-2.5 animate-pop-in">
          <ShieldWarningIcon size={18} weight="bold" className="text-amber-500 shrink-0 mt-0.5" aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-amber-700 mb-1">Hold on, check your message!</p>
            <ul className="list-none m-0 p-0 flex flex-col gap-0.5">
              {warnings.map((w, i) => (
                <li key={i} className="text-xs text-amber-700 flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${w.type === 'inappropriate' ? 'bg-red-400' : 'bg-amber-400'}`} />
                  {w.label}
                </li>
              ))}
            </ul>
            {preview?.tip && (
              <p className="text-xs text-amber-800 mt-1.5 mb-0 flex items-start gap-1">
                <LightbulbIcon size={14} weight="fill" className="shrink-0 mt-px" aria-hidden />
                {preview.tip}
              </p>
            )}
          </div>
        </div>
      )}

      {sendError && (
        <div role="alert" className="bg-red-50 text-red-600 text-sm px-4 py-2 border-t border-red-200 flex items-center gap-2">
          <WarningIcon size={14} weight="bold" aria-hidden />
          {sendError}
        </div>
      )}

      <div className="bg-white px-4 py-3 border-t border-rust-brown-100 flex items-center gap-3">
        <label htmlFor="message-draft" className="sr-only">Message</label>
        <input
          id="message-draft"
          type="text"
          value={draft}
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder={`Message via ${displayPlatform(platform)}…`}
          disabled={sending}
          className={`flex-1 bg-soft-peach-50 border rounded-2xl px-4 py-2.5 text-sm text-ink-black-800 placeholder:text-ink-black-300 outline-none transition-all disabled:opacity-50 ${
            warnings.length > 0
              ? 'border-amber-300 focus:border-amber-400 focus:ring-2 focus:ring-amber-100'
              : 'border-rust-brown-100 focus:border-rust-brown-300 focus:ring-2 focus:ring-rust-brown-100'
          }`}
        />
        {checking && <CircleNotchIcon size={14} className="animate-spin text-ink-black-300" aria-label="Checking message" />}
        <button
          type="button"
          onClick={handleSend}
          disabled={!draft.trim() || sending}
          aria-label="Send message"
          className="w-10 h-10 rounded-full bg-rust-brown-500 text-white border-none flex items-center justify-center cursor-pointer hover:bg-rust-brown-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          {sending ? <CircleNotchIcon size={18} weight="bold" className="animate-spin" /> : <PaperPlaneRightIcon size={18} weight="bold" />}
        </button>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowConfirm(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="bg-white rounded-3xl p-6 max-w-sm w-[90%] shadow-2xl animate-pop-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <ShieldWarningIcon size={24} weight="bold" className="text-amber-500" aria-hidden />
              <h3 id="confirm-title" className="text-lg font-bold text-ink-black-800">Are you sure?</h3>
            </div>
            {preview?.tip && <p className="text-sm text-ink-black-600 mb-3">{preview.tip}</p>}
            <div className="bg-amber-50 rounded-xl px-4 py-3 mb-4">
              <ul className="list-none m-0 p-0 flex flex-col gap-1">
                {warnings.map((w, i) => (
                  <li key={i} className="text-sm text-amber-700 flex items-start gap-2">
                    <InfoIcon size={16} weight="bold" className="text-amber-500 shrink-0 mt-0.5" aria-hidden />
                    {w.label}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex gap-2">
              <button autoFocus onClick={() => setShowConfirm(false)} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold border border-rust-brown-200 bg-white text-ink-black-700 cursor-pointer hover:bg-soft-peach-50 transition-colors">
                Go back
              </button>
              <button onClick={doSend} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold border-none bg-amber-500 text-white cursor-pointer hover:bg-amber-600 transition-colors">
                Send anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
