import { ShieldCheckIcon, HourglassMediumIcon, EyeSlashIcon, ImageBrokenIcon, VideoIcon } from '@phosphor-icons/react'
import { isAttachmentHidden, isImageAttachment, messageStatus, type FirestoreMessage, type MessageAttachment } from '../../types/message'
import { Avatar } from '../common/ui'

interface ChatBubbleProps {
  msg: FirestoreMessage
  onImageClick: (url: string) => void
  childName: string
  childAvatar?: string | null
}

const formatTime = (msg: FirestoreMessage) =>
  msg.timestamp?.toDate?.().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? ''

function HiddenAttachment({ a }: { a: MessageAttachment }) {
  const video = a.kind === 'video'
  return (
    <div className="relative rounded-xl overflow-hidden w-56 h-36 bg-gradient-to-br from-ink-black-200 to-ink-black-300 flex flex-col items-center justify-center gap-1 text-white">
      <div className="absolute inset-0 backdrop-blur-xl" />
      {video ? <VideoIcon size={28} weight="duotone" className="relative" aria-hidden /> : <ImageBrokenIcon size={28} weight="duotone" className="relative" aria-hidden />}
      <span className="relative text-xs font-semibold text-center px-3">
        {a.status === 'needs_review' ? `A grown-up will check this ${video ? 'video' : 'picture'} first` : `${video ? 'Video' : 'Picture'} hidden to keep you safe`}
      </span>
    </div>
  )
}

function Attachments({ items, onImageClick }: { items?: MessageAttachment[]; onImageClick: (url: string) => void }) {
  if (!items?.length) return null
  return (
    <div className="flex flex-col gap-1.5 mt-1">
      {items.map((a, i) =>
        isAttachmentHidden(a) ? (
          <HiddenAttachment key={i} a={a} />
        ) : isImageAttachment(a) ? (
          <button key={i} type="button" onClick={() => onImageClick(a.url!)} className="p-0 border-none bg-transparent cursor-zoom-in">
            <img src={a.url!} alt={a.filename || 'Image'} className="rounded-xl max-w-full max-h-64 object-contain hover:opacity-90 transition-opacity" />
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

export default function ChatBubble({ msg, onImageClick, childName, childAvatar }: ChatBubbleProps) {
  const isSent = !!msg.is_sent
  const status = messageStatus(msg)
  const displayName = isSent ? childName : msg.username
  const avatarSrc = isSent ? childAvatar : msg.profile_picture_flagged ? null : msg.profile_picture
  const align = isSent ? 'self-end rounded-br-[6px]' : 'self-start rounded-bl-[6px]'

  // Incoming message hidden by the safety check: soft card with a coaching tip, never the content.
  if (!isSent && (status === 'censored' || status === 'needs_review')) {
    const review = status === 'needs_review'
    return (
      <div data-testid="bubble-hidden" className={`max-w-[75%] px-4 py-3 rounded-[20px] animate-pop-in shadow-sm border ${review ? 'bg-violet-50 border-violet-200' : 'bg-sky-50 border-sky-200'} ${align}`}>
        <div className="flex items-center gap-2 mb-1">
          <Avatar src={avatarSrc} size={20} />
          <span className="text-xs font-bold text-ink-black-600">{displayName}</span>
        </div>
        <div className="flex items-start gap-2">
          {review ? (
            <HourglassMediumIcon size={20} weight="duotone" className="text-violet-500 shrink-0 mt-0.5" aria-hidden />
          ) : (
            <ShieldCheckIcon size={20} weight="duotone" className="text-sky-600 shrink-0 mt-0.5" aria-hidden />
          )}
          <div>
            <p className="text-sm font-semibold text-ink-black-700 m-0">
              {review ? 'A grown-up is double-checking this message' : 'We hid this message to keep you safe'}
            </p>
            {msg.coach_tip && <p className="text-sm text-ink-black-500 mt-1 mb-0">{msg.coach_tip}</p>}
          </div>
        </div>
        <span className="text-[0.68rem] text-ink-black-300 block mt-1 text-right">{formatTime(msg)}</span>
      </div>
    )
  }

  const masked = !isSent && status === 'masked'
  const text = masked ? msg.masked_content ?? '' : msg.message

  return (
    <div
      data-testid={masked ? 'bubble-masked' : 'bubble'}
      className={`max-w-[75%] px-4 py-2.5 rounded-[20px] animate-pop-in shadow-sm ${
        isSent ? `${align} bg-rust-brown-500 text-white` : `${align} bg-white text-ink-black-800`
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Avatar src={avatarSrc} size={20} />
        <span className={`text-xs font-bold ${isSent ? 'text-white/80' : 'text-rust-brown-500'}`}>{displayName}</span>
      </div>

      {text && <p className="text-[0.95rem] leading-relaxed m-0 whitespace-pre-wrap break-words">{text}</p>}

      <Attachments items={msg.attachments} onImageClick={onImageClick} />

      {masked && (
        <div className="mt-1.5 flex flex-col gap-1">
          <span className="self-start inline-flex items-center gap-1 text-[0.68rem] font-semibold bg-amber-50 text-amber-700 rounded-full px-2 py-0.5">
            <EyeSlashIcon size={12} weight="bold" aria-hidden /> Some words were hidden
          </span>
          {msg.coach_tip && <span className="text-xs text-ink-black-400">{msg.coach_tip}</span>}
        </div>
      )}

      <span className="text-[0.68rem] opacity-60 block mt-1 text-right">{formatTime(msg)}</span>
    </div>
  )
}
