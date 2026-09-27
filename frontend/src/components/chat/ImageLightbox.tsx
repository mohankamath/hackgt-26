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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 border-none text-white flex items-center justify-center cursor-pointer transition-colors"
      >
        <XIcon size={22} weight="bold" />
      </button>
      <img
        src={url}
        alt=""
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}
