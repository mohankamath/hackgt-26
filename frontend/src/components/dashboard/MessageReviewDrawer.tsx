import { useEffect, useState } from 'react'
import { XIcon, EyeIcon, CircleNotchIcon, ProhibitIcon, PaperPlaneRightIcon } from '@phosphor-icons/react'
import { reviewMessage, signedMediaUrl } from '../../lib/api'
import { isAttachmentHidden, isImageAttachment, messageStatus, type FirestoreMessage, type MessageAttachment } from '../../types/message'
import type { ContactStatus } from '../../types/safety'
import { displayPlatform } from '../../types/channel'
import { Avatar, CategoryTags, SeverityBadge, StatusBadge } from '../common/ui'
import { formatDateTime } from '../../lib/format'

interface Props {
  msg: FirestoreMessage
  contactStatus?: ContactStatus
  onClose: () => void
  onSetContactStatus: (id: string, status: ContactStatus) => Promise<unknown>
}

function ReviewAttachment({ a }: { a: MessageAttachment }) {
  const hidden = isAttachmentHidden(a)
  const [url, setUrl] = useState<string | null>(hidden ? null : a.url)
  const [revealed, setRevealed] = useState(!hidden)
  const [err, setErr] = useState<string | null>(null)

  const reveal = async () => {
    setErr(null)
    try {
      const u = a.review_url ?? (a.storage_path ? await signedMediaUrl(a.storage_path) : null)
      if (!u) throw new Error('Original file is not available')
      setUrl(u)
      setRevealed(true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load')
    }
  }

  return (
    <div className="rounded-xl border border-ink-black-100 p-2">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-xs font-semibold text-ink-black-600 truncate">{a.filename}</span>
        {a.status && <StatusBadge status={a.status} />}
        <CategoryTags categories={a.categories} />
        {a.error && <span className="text-[0.65rem] text-violet-600">{a.error}</span>}
      </div>
      {url && revealed ? (
        isImageAttachment(a) ? (
          <img src={url} alt={a.filename} className={`rounded-lg max-h-72 max-w-full object-contain ${hidden ? 'blur-xl hover:blur-none transition-[filter]' : ''}`} />
        ) : (
          <a href={url} target="_blank" rel="noreferrer" className="text-sm underline">Open {a.kind ?? 'file'}</a>
        )
      ) : (
        <button onClick={reveal} className="flex items-center gap-1.5 text-xs font-semibold bg-ink-black-50 hover:bg-ink-black-100 border-none rounded-lg px-3 py-2 cursor-pointer text-ink-black-600">
          <EyeIcon size={14} weight="bold" aria-hidden /> Load for review (shown blurred, hover to view)
        </button>
      )}
      {err && <p className="text-xs text-red-600 mt-1 mb-0">{err}</p>}
    </div>
  )
}

export default function MessageReviewDrawer({ msg, contactStatus, onClose, onSetContactStatus }: Props) {
  const status = messageStatus(msg)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  const override = (s: 'safe' | 'masked' | 'censored') =>
    act(s, () => reviewMessage(msg.collection ?? 'messages', msg.id!, s))

  const scores = Object.entries(msg.moderation?.scores ?? {}).filter(([, v]) => v >= 0.01)

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-labelledby="drawer-title" className="bg-white w-full max-w-md h-full overflow-y-auto shadow-2xl p-6 animate-pop-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <Avatar src={msg.is_sent ? null : msg.profile_picture} size={40} />
          <div className="flex-1 min-w-0">
            <h3 id="drawer-title" className="text-lg font-bold text-ink-black-800 m-0 truncate">{msg.is_sent ? 'Sent by your child' : msg.username}</h3>
            <p className="text-xs text-ink-black-400 m-0">
              {displayPlatform(msg.platform)} · {msg.channel_name} · {formatDateTime(msg.timestamp?.toMillis?.() ?? 0)}
            </p>
          </div>
          <button autoFocus onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full bg-soft-peach-50 hover:bg-soft-peach-100 border-none flex items-center justify-center cursor-pointer">
            <XIcon size={18} weight="bold" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <StatusBadge status={status} />
          <SeverityBadge severity={msg.severity} />
          {msg.reviewed_by_parent && <span className="text-[0.65rem] text-ink-black-400">reviewed by you</span>}
          {msg.profile_picture_flagged && <span className="text-[0.65rem] font-semibold text-red-600">flagged profile picture</span>}
        </div>

        <div className="bg-soft-peach-50 rounded-xl p-4 mb-4">
          <p className="text-[0.7rem] font-bold uppercase tracking-wide text-ink-black-400 m-0 mb-1">Original message</p>
          <p className="text-sm text-ink-black-800 whitespace-pre-wrap break-words m-0">{msg.message || <em className="text-ink-black-300">(no text)</em>}</p>
          {status === 'masked' && msg.masked_content && (
            <>
              <p className="text-[0.7rem] font-bold uppercase tracking-wide text-ink-black-400 mt-3 mb-1">What your child sees</p>
              <p className="text-sm text-ink-black-700 m-0">{msg.masked_content}</p>
            </>
          )}
          {msg.coach_tip && (
            <>
              <p className="text-[0.7rem] font-bold uppercase tracking-wide text-ink-black-400 mt-3 mb-1">Tip shown to your child</p>
              <p className="text-sm text-ink-black-700 m-0">{msg.coach_tip}</p>
            </>
          )}
        </div>

        {!!msg.moderation?.reasons?.length && (
          <div className="mb-4">
            <p className="text-[0.7rem] font-bold uppercase tracking-wide text-ink-black-400 m-0 mb-1">Why</p>
            <ul className="m-0 pl-4 text-sm text-ink-black-700">{msg.moderation.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            <div className="mt-2"><CategoryTags categories={msg.moderation.categories} max={8} /></div>
          </div>
        )}
        {!!msg.pii?.length && (
          <p className="text-sm text-amber-700 mb-4">Possible personal info: {msg.pii.map((p) => p.label).join(', ')}</p>
        )}

        {scores.length > 0 && (
          <div className="mb-4">
            <p className="text-[0.7rem] font-bold uppercase tracking-wide text-ink-black-400 m-0 mb-2">OpenAI moderation scores</p>
            <ul className="list-none p-0 m-0 flex flex-col gap-1.5">
              {scores.map(([k, v]) => (
                <li key={k} className="flex items-center gap-2 text-xs">
                  <span className="w-40 text-ink-black-600 truncate">{k}</span>
                  <span className="flex-1 h-1.5 rounded-full bg-ink-black-50 overflow-hidden">
                    <span className={`block h-full rounded-full ${v >= 0.5 ? 'bg-red-500' : v >= 0.2 ? 'bg-orange-400' : 'bg-ink-black-300'}`} style={{ width: `${Math.round(v * 100)}%` }} />
                  </span>
                  <span className="w-10 text-right text-ink-black-500">{Math.round(v * 100)}%</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!!msg.attachments?.length && (
          <div className="mb-4 flex flex-col gap-2">
            <p className="text-[0.7rem] font-bold uppercase tracking-wide text-ink-black-400 m-0">Attachments</p>
            {msg.attachments.map((a, i) => <ReviewAttachment key={i} a={a} />)}
          </div>
        )}

        {!msg.is_sent && (
          <div className="border-t border-soft-peach-100 pt-4 flex flex-col gap-3">
            <p className="text-[0.7rem] font-bold uppercase tracking-wide text-ink-black-400 m-0">Your decision for this message</p>
            <div className="flex gap-2 flex-wrap">
              {(['safe', 'masked', 'censored'] as const).map((s) => (
                <button
                  key={s}
                  disabled={!!busy || status === s}
                  onClick={() => override(s)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border-none cursor-pointer disabled:opacity-40 ${
                    s === 'safe' ? 'bg-green-500 text-white hover:bg-green-600' : s === 'masked' ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-red-500 text-white hover:bg-red-600'
                  }`}
                >
                  {busy === s && <CircleNotchIcon size={12} className="animate-spin" />}
                  {s === 'safe' ? 'Show to child' : s === 'masked' ? 'Mask bad words' : 'Hide from child'}
                </button>
              ))}
            </div>
            {msg.contact_id && contactStatus !== 'blocked' && (
              <button
                disabled={!!busy}
                onClick={() => act('block', () => onSetContactStatus(msg.contact_id!, 'blocked'))}
                className="self-start flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-red-200 bg-white text-red-600 cursor-pointer hover:bg-red-50 disabled:opacity-40"
              >
                <ProhibitIcon size={14} weight="bold" aria-hidden /> Block {msg.username}
              </button>
            )}
          </div>
        )}
        {msg.is_sent && (
          <p className="text-xs text-ink-black-400 flex items-center gap-1"><PaperPlaneRightIcon size={12} aria-hidden /> Messages your child sends are never blocked, only flagged for you.</p>
        )}
        {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
      </aside>
    </div>
  )
}
