import { ShieldCheckIcon, HourglassMediumIcon, EyeSlashIcon, ImageBrokenIcon, VideoIcon, LightbulbIcon } from '@phosphor-icons/react'
import { isAttachmentHidden, isImageAttachment, messageStatus, type FirestoreMessage, type MessageAttachment } from '../../types/message'
import { Avatar } from '../common/ui'

interface ChatBubbleProps {
  msg: FirestoreMessage
  onImageClick: (url: string) => void
  childName: string
  childAvatar?: string | null
  /** Same sender as the previous bubble within a few minutes: hide the name/avatar header. */
  grouped?: boolean
}

const formatTime = (msg: FirestoreMessage) =>
  msg.timestamp?.toDate?.().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) ?? ''

function HiddenAttachment({ a }: { a: MessageAttachment }) {
  const video = a.kind === 'video'
  const Icon = video ? VideoIcon : ImageBrokenIcon
  return (
    <div className="relative rounded-xl overflow-hidden w-60 h-36 bg-surface-3 ring-1 ring-line flex flex-col items-center justify-center gap-1.5 text-muted">
      <div className="absolute inset-0 bg-grid opacity-60" aria-hidden />
      <Icon size={28} weight="duotone" className="relative text-accent" aria-hidden />
      <span className="relative text-xs font-medium text-center px-4 text-fg-soft">
        {a.status === 'needs_review' ? `A grown-up will check this ${video ? 'video' : 'picture'} first` : `${video ? 'Video' : 'Picture'} hidden to keep you safe`}
      </span>
    </div>
  )
}

function Attachments({ items, onImageClick }: { items?: MessageAttachment[]; onImageClick: (url: string) => void }) {
  if (!items?.length) return null
  return (
    <div className="flex flex-col gap-1.5 mt-1.5">
      {items.map((a, i) =>
        isAttachmentHidden(a) ? (
          <HiddenAttachment key={i} a={a} />
        ) : isImageAttachment(a) ? (
          <button key={i} type="button" onClick={() => onImageClick(a.url!)} className="p-0 border-none bg-transparent cursor-zoom-in">
            <img src={a.url!} alt={a.filename || 'Image'} className="rounded-xl max-w-full max-h-72 object-contain hover:opacity-90 transition-opacity" />
          </button>
        ) : (
          <a key={i} href={a.url!} target="_blank" rel="noreferrer" className="text-sm underline break-all">
            {a.filename}
          </a>
        ),
      )}
    </div>
  )
}

export default function ChatBubble({ msg, onImageClick, childName, childAvatar, grouped = false }: ChatBubbleProps) {
  const isSent = !!msg.is_sent
  const status = messageStatus(msg)
  const displayName = isSent ? childName : msg.username
  const avatarSrc = isSent ? childAvatar : msg.profile_picture_flagged ? null : msg.profile_picture
  const time = formatTime(msg)

  const row = (content: React.ReactNode) => (
    <div className={`flex items-end gap-2 max-w-[78%] animate-rise ${isSent ? 'self-end flex-row-reverse' : 'self-start'} ${grouped ? '-mt-3' : ''}`} title={grouped ? time : undefined}>
      {grouped ? <span className="w-7 shrink-0" aria-hidden /> : <Avatar src={avatarSrc} size={28} />}
      <div className={`flex flex-col ${isSent ? 'items-end' : 'items-start'} min-w-0`}>
        {!grouped && (
          <span className="text-[0.68rem] text-muted mb-1 px-1">
            <span className="font-medium text-fg-soft">{displayName}</span> · {time}
          </span>
        )}
        {content}
      </div>
    </div>
  )

  // Incoming message hidden by the safety check: calm card with a coaching tip, never the content.
  if (!isSent && (status === 'censored' || status === 'needs_review')) {
    const review = status === 'needs_review'
    return row(
      <div data-testid="bubble-hidden" className={`rounded-2xl rounded-bl-md px-4 py-3 ring-1 ${review ? 'bg-review/10 ring-review/25' : 'bg-accent-2/10 ring-accent-2/25'}`}>
        <div className="flex items-start gap-2.5">
          {review ? (
            <HourglassMediumIcon size={20} weight="duotone" className="text-review shrink-0 mt-0.5" aria-hidden />
          ) : (
            <ShieldCheckIcon size={20} weight="duotone" className="text-accent-2 shrink-0 mt-0.5" aria-hidden />
          )}
          <div>
            <p className="text-sm font-medium text-fg m-0">
              {review ? 'A grown-up is double-checking this message' : 'We hid this message to keep you safe'}
            </p>
            {msg.coach_tip && <p className="text-sm text-fg-soft mt-1 mb-0 leading-relaxed">{msg.coach_tip}</p>}
          </div>
        </div>
      </div>,
    )
  }

  const masked = !isSent && status === 'masked'
  const text = masked ? msg.masked_content ?? '' : msg.message

  return row(
    <>
      <div
        data-testid={masked ? 'bubble-masked' : 'bubble'}
        className={`px-4 py-2.5 text-[0.95rem] leading-relaxed ${
          isSent ? 'bg-accent-gradient text-abyss rounded-2xl rounded-br-md' : 'bg-surface-3 text-fg rounded-2xl rounded-bl-md ring-1 ring-line'
        }`}
      >
        {text && <p className="m-0 whitespace-pre-wrap break-words">{text}</p>}
        <Attachments items={msg.attachments} onImageClick={onImageClick} />
      </div>
      {masked && (
        <div className="mt-1.5 flex flex-col gap-1 px-1">
          <span className="self-start inline-flex items-center gap-1 text-[0.68rem] font-medium text-warn">
            <EyeSlashIcon size={12} weight="bold" aria-hidden /> Some words were hidden
          </span>
          {msg.coach_tip && (
            <span className="text-xs text-muted flex items-start gap-1">
              <LightbulbIcon size={12} weight="fill" className="text-warn shrink-0 mt-0.5" aria-hidden />
              {msg.coach_tip}
            </span>
          )}
        </div>
      )}
    </>,
  )
}
