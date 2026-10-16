import { useCardImage, type ImageSource } from '../data/images'
import { speak } from '../lib/tts'
import { Star, Volume2 } from './icons'

export function StarButton({
  starred,
  onToggle,
  size = 20,
  className = 'btn btn-ghost btn-icon',
}: {
  starred: boolean
  onToggle: () => void
  size?: number
  className?: string
}) {
  return (
    <button
      type="button"
      className={`${className} star-btn`}
      aria-pressed={starred}
      aria-label={starred ? 'Unstar term' : 'Star term'}
      title={starred ? 'Unstar (S)' : 'Star (S)'}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      <Star size={size} />
    </button>
  )
}

export function AudioButton({
  text,
  lang,
  voiceURI,
  size = 20,
  className = 'btn btn-ghost btn-icon',
  label = 'Play audio',
  shortcut,
}: {
  text: string
  lang: string
  voiceURI?: string
  size?: number
  className?: string
  label?: string
  /** Keyboard shortcut shown in the tooltip, e.g. "A". */
  shortcut?: string
}) {
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      onClick={(e) => {
        e.stopPropagation()
        speak(text, lang, { voiceURI })
      }}
    >
      <Volume2 size={size} />
    </button>
  )
}

export function CardImage({
  card,
  source,
  className = 'card-image',
  alt = '',
}: {
  card: { imageId?: string | null; imageUrl?: string | null }
  source: ImageSource
  className?: string
  alt?: string
}) {
  const url = useCardImage(card, source)
  if (!url) return null
  return <img className={className} src={url} alt={alt} loading="lazy" draggable={false} />
}
