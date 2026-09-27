import { useEffect } from 'react'
import { XIcon } from '@phosphor-icons/react'

interface ImageLightboxProps {
  url: string
  onClose: () => void
}

export default function ImageLightbox({ url, onClose }: ImageLightboxProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div role="dialog" aria-modal="true" aria-label="Image preview" className="fixed inset-0 z-50 flex items-center justify-center bg-abyss/90 backdrop-blur-md" onClick={onClose}>
      <button
        autoFocus
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-surface-3 ring-1 ring-line hover:bg-line border-none text-fg flex items-center justify-center transition-colors"
      >
        <XIcon size={20} weight="bold" />
      </button>
      <img src={url} alt="" className="max-w-[90vw] max-h-[90vh] object-contain rounded-2xl shadow-2xl animate-pop-in" onClick={(e) => e.stopPropagation()} />
    </div>
  )
}
