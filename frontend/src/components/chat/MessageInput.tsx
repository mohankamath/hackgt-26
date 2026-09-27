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
      <div className="px-5 py-4 border-t border-line bg-surface flex items-center justify-center gap-2 text-sm text-muted">
        <LockSimpleIcon size={16} weight="duotone" aria-hidden />
        {disabledReason}
      </div>
    )
  }

  const warn = warnings.length > 0

  return (
    <div className="px-4 pb-4 pt-2">
      {warn && !showConfirm && (
        <div role="status" className="mb-2 rounded-xl bg-warn/10 ring-1 ring-warn/30 px-4 py-3 flex items-start gap-2.5 animate-rise">
          <ShieldWarningIcon size={18} weight="duotone" className="text-warn shrink-0 mt-0.5" aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-warn m-0 mb-1">Hold on, check your message!</p>
            <ul className="list-none m-0 p-0 flex flex-col gap-0.5">
              {warnings.map((w, i) => (
                <li key={i} className="text-xs text-fg-soft flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${w.type === 'inappropriate' ? 'bg-danger' : 'bg-warn'}`} />
                  {w.label}
                </li>
              ))}
            </ul>
            {preview?.tip && (
              <p className="text-xs text-fg-soft mt-2 mb-0 flex items-start gap-1.5">
                <LightbulbIcon size={14} weight="fill" className="text-warn shrink-0 mt-px" aria-hidden />
                {preview.tip}
              </p>
            )}
          </div>
        </div>
      )}

      {sendError && (
        <div role="alert" className="mb-2 rounded-xl bg-danger/10 ring-1 ring-danger/30 text-danger text-sm px-4 py-2 flex items-center gap-2">
          <WarningIcon size={14} weight="bold" aria-hidden />
          {sendError}
        </div>
      )}

      <div className={`flex items-center gap-2 rounded-2xl bg-surface-2 ring-1 px-2 py-1.5 transition-shadow focus-within:ring-2 ${warn ? 'ring-warn/50 focus-within:ring-warn/60' : 'ring-line focus-within:ring-accent/60'}`}>
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
          placeholder={`Message on ${displayPlatform(platform)}…`}
          disabled={sending}
          className="flex-1 bg-transparent border-none outline-none px-2.5 py-2 text-sm text-fg placeholder:text-subtle disabled:opacity-50"
        />
        {checking && <CircleNotchIcon size={14} className="animate-spin text-subtle" aria-label="Checking message" />}
        <button
          type="button"
          onClick={handleSend}
          disabled={!draft.trim() || sending}
          aria-label="Send message"
          className="w-10 h-10 rounded-xl bg-accent-gradient text-abyss border-none flex items-center justify-center hover:brightness-110 transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
        >
          {sending ? <CircleNotchIcon size={18} weight="bold" className="animate-spin" /> : <PaperPlaneRightIcon size={18} weight="fill" />}
        </button>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-abyss/80 backdrop-blur-sm" onClick={() => setShowConfirm(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="panel bg-surface-2 p-6 max-w-sm w-[90%] animate-pop-in" onClick={(e) => e.stopPropagation()}>
            <div className="w-11 h-11 rounded-xl bg-warn/15 ring-1 ring-warn/30 flex items-center justify-center mb-4">
              <ShieldWarningIcon size={24} weight="duotone" className="text-warn" aria-hidden />
            </div>
            <h3 id="confirm-title" className="text-lg font-semibold text-fg m-0 mb-1">Are you sure?</h3>
            {preview?.tip && <p className="text-sm text-fg-soft mt-0 mb-4">{preview.tip}</p>}
            <ul className="list-none m-0 mb-5 p-0 flex flex-col gap-1.5">
              {warnings.map((w, i) => (
                <li key={i} className="text-sm text-fg-soft flex items-start gap-2">
                  <InfoIcon size={16} className="text-warn shrink-0 mt-0.5" aria-hidden />
                  {w.label}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button autoFocus onClick={() => setShowConfirm(false)} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold border-none bg-accent-gradient text-abyss hover:brightness-110">
                Go back
              </button>
              <button onClick={doSend} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium border-none bg-surface-3 ring-1 ring-line text-fg-soft hover:text-fg">
                Send anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
