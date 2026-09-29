import { useEffect, useState } from 'react'
import { XIcon, EyeIcon, CircleNotchIcon, ProhibitIcon, PaperPlaneRightIcon, CheckIcon, EyeSlashIcon, ShieldSlashIcon, IdentificationCardIcon } from '@phosphor-icons/react'
import { reviewMessage, signedMediaUrl } from '../../lib/api'
import { isAttachmentHidden, isImageAttachment, isVideoAttachment, messageStatus, type FirestoreMessage, type MessageAttachment } from '../../types/message'
import type { ContactStatus } from '../../types/safety'
import { displayPlatform } from '../../types/channel'
import { Avatar, Button, CategoryTags, SectionLabel, SeverityBadge, StatusBadge } from '../common/ui'
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
    <div className="rounded-xl bg-surface-2 ring-1 ring-line p-3">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-xs font-medium text-fg-soft truncate">{a.filename}</span>
        {a.status && <StatusBadge status={a.status} />}
        <CategoryTags categories={a.categories} />
      </div>
      {a.error && <p className="text-[0.7rem] text-review m-0 mb-2">{a.error}</p>}
      {url && revealed ? (
        isImageAttachment(a) ? (
          <img src={url} alt={a.filename} className={`rounded-lg max-h-72 max-w-full object-contain ${hidden ? 'blur-xl hover:blur-none transition-[filter] duration-300' : ''}`} />
        ) : isVideoAttachment(a) ? (
          <video src={url} controls preload="metadata" className="rounded-lg max-h-72 max-w-full" aria-label={a.filename || 'Video'} />
        ) : (
          <a href={url} target="_blank" rel="noreferrer" className="text-sm text-accent underline">Open {a.kind ?? 'file'}</a>
        )
      ) : (
        <Button size="sm" onClick={reveal}>
          <EyeIcon size={14} aria-hidden /> Load for review (blurred; hover to view)
        </Button>
      )}
      {err && <p className="text-xs text-danger mt-1.5 mb-0">{err}</p>}
    </div>
  )
}

const reviewMediaKind = (msg: FirestoreMessage) => {
  const attachments = msg.attachments ?? []
  const hasImage = attachments.some((a) => isImageAttachment(a))
  const hasVideo = attachments.some((a) => isVideoAttachment(a))
  if (hasVideo && !hasImage) return 'video'
  if (hasImage && !hasVideo) return 'image'
  return hasImage || hasVideo ? 'media' : null
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

  const override = (s: 'safe' | 'masked' | 'censored') => act(s, () => reviewMessage(msg.collection ?? 'messages', msg.id!, s))
  const approveMedia = () => act('safe', async () => {
    await reviewMessage(msg.collection ?? 'messages', msg.id!, 'safe')
    onClose()
  })
  const hideMedia = () => act('hide_image', async () => {
    await reviewMessage(msg.collection ?? 'messages', msg.id!, 'hide_image')
    onClose()
  })
  const mediaKind = reviewMediaKind(msg)
  const mediaReview = mediaKind !== null
  const scores = Object.entries(msg.moderation?.scores ?? {}).filter(([, v]) => v >= 0.01)

  const decisions = mediaReview
    ? [
        { key: 'safe', label: `Approve ${mediaKind}`, icon: CheckIcon, variant: 'ok' as const, action: approveMedia },
        { key: 'hide_image', label: `Mask ${mediaKind}`, icon: EyeSlashIcon, variant: 'warn' as const, action: hideMedia },
      ]
    : [
        { key: 'safe', label: 'Show to child', icon: CheckIcon, variant: 'ok' as const, action: () => override('safe') },
        { key: 'masked', label: 'Mask words', icon: EyeSlashIcon, variant: 'warn' as const, action: () => override('masked') },
        { key: 'censored', label: 'Hide', icon: ShieldSlashIcon, variant: 'danger' as const, action: () => override('censored') },
      ]

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-abyss/70 backdrop-blur-sm" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        className="bg-surface border-l border-line w-full max-w-md h-full overflow-y-auto shadow-2xl flex flex-col animate-[rise_0.25s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 z-10 bg-surface/95 backdrop-blur-xl border-b border-line px-6 py-4 flex items-center gap-3">
          <Avatar src={msg.is_sent ? null : msg.profile_picture} size={40} />
          <div className="flex-1 min-w-0">
            <h3 id="drawer-title" className="text-base font-semibold m-0 truncate">{msg.is_sent ? 'Sent by your child' : msg.username}</h3>
            <p className="text-xs text-muted m-0 truncate">
              {displayPlatform(msg.platform)} · {msg.channel_name} · {formatDateTime(msg.timestamp?.toMillis?.() ?? 0)}
            </p>
          </div>
          <button autoFocus onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-lg bg-surface-2 ring-1 ring-line hover:bg-surface-3 border-none text-fg-soft flex items-center justify-center">
            <XIcon size={16} />
          </button>
        </header>

        <div className="px-6 py-5 flex flex-col gap-5 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={status} />
            <SeverityBadge severity={msg.severity} />
            {msg.reviewed_by_parent && <span className="text-[0.7rem] text-subtle">reviewed by you</span>}
            {msg.profile_picture_flagged && <span className="text-[0.7rem] text-danger">flagged profile picture</span>}
          </div>

          <div>
            <SectionLabel>Original message</SectionLabel>
            <div className="rounded-xl bg-bg ring-1 ring-line p-4">
              <p className="text-sm text-fg whitespace-pre-wrap break-words m-0 leading-relaxed">{msg.message || <em className="text-subtle">(no text)</em>}</p>
            </div>
          </div>

          {status === 'masked' && msg.masked_content && (
            <div>
              <SectionLabel>What your child sees</SectionLabel>
              <p className="text-sm text-fg-soft m-0">{msg.masked_content}</p>
            </div>
          )}
          {msg.coach_tip && (
            <div>
              <SectionLabel>Tip shown to your child</SectionLabel>
              <p className="text-sm text-accent-2 m-0 leading-relaxed">{msg.coach_tip}</p>
            </div>
          )}

          {!!msg.moderation?.reasons?.length && (
            <div>
              <SectionLabel>Why it was flagged</SectionLabel>
              <ul className="m-0 p-0 list-none flex flex-col gap-1 mb-2">
                {msg.moderation.reasons.map((r) => (
                  <li key={r} className="text-sm text-fg-soft pl-3 relative before:absolute before:left-0 before:top-2 before:w-1 before:h-1 before:rounded-full before:bg-alert">{r}</li>
                ))}
              </ul>
              <CategoryTags categories={msg.moderation.categories} max={8} />
            </div>
          )}

          {!!msg.pii?.length && (
            <p className="text-sm text-warn m-0 flex items-center gap-1.5">
              <IdentificationCardIcon size={16} aria-hidden /> Possible personal info: {msg.pii.map((p) => p.label).join(', ')}
            </p>
          )}

          {scores.length > 0 && (
            <div>
              <SectionLabel>OpenAI moderation scores</SectionLabel>
              <ul className="list-none p-0 m-0 flex flex-col gap-2">
                {scores.map(([k, v]) => (
                  <li key={k} className="flex items-center gap-3 text-xs">
                    <span className="w-36 text-muted truncate font-mono">{k}</span>
                    <span className="flex-1 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                      <span className={`block h-full rounded-full ${v >= 0.5 ? 'bg-danger' : v >= 0.2 ? 'bg-alert' : 'bg-line-strong'}`} style={{ width: `${Math.round(v * 100)}%` }} />
                    </span>
                    <span className="w-10 text-right text-fg-soft tabular-nums">{Math.round(v * 100)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!!msg.attachments?.length && (
            <div className="flex flex-col gap-2">
              <SectionLabel>Attachments</SectionLabel>
              {msg.attachments.map((a, i) => <ReviewAttachment key={i} a={a} />)}
            </div>
          )}
          {msg.is_sent && (
            <p className="text-xs text-muted m-0 flex items-center gap-1.5">
              <PaperPlaneRightIcon size={12} aria-hidden /> Messages your child sends are never blocked, only flagged for you.
            </p>
          )}
        </div>

        {!msg.is_sent && (
          <footer className="sticky bottom-0 bg-surface/95 backdrop-blur-xl border-t border-line px-6 py-4 flex flex-col gap-3">
            <SectionLabel>Your decision</SectionLabel>
            <div className="grid grid-cols-3 gap-2">
              {decisions.map(({ key, label, icon: Icon, variant, action }) => (
                <Button key={key} size="sm" variant={variant} disabled={!!busy} onClick={action}>
                  {busy === key ? <CircleNotchIcon size={13} className="animate-spin" /> : <Icon size={13} weight="bold" aria-hidden />}
                  {label}
                </Button>
              ))}
            </div>
            {msg.contact_id && contactStatus !== 'blocked' && (
              <Button size="sm" variant="outline-danger" disabled={!!busy} onClick={() => act('block', () => onSetContactStatus(msg.contact_id!, 'blocked'))}>
                <ProhibitIcon size={14} weight="bold" aria-hidden /> Block {msg.username}
              </Button>
            )}
            {error && <p className="text-xs text-danger m-0">{error}</p>}
          </footer>
        )}
      </aside>
    </div>
  )
}
