import { getDoc, setDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { compressImage } from '../lib/image'
import { imageRef, newId, publicImageRef } from './paths'
import { track } from './sync'

const cache = new Map<string, string>()

/** Compresses and stores an image in users/{uid}/images; returns its id. */
export async function saveImage(uid: string, file: Blob): Promise<string> {
  const img = await compressImage(file)
  const id = newId()
  cache.set(`${uid}/${id}`, img.dataUrl)
  void track(setDoc(imageRef(uid, id), img), 'save image')
  return id
}

export interface ImageSource {
  ownerUid?: string | null
  publicSetId?: string | null
}

/** Resolves a card's image: an external URL, or a stored image doc (owner's or a shared set's copy). */
export function useCardImage(card: { imageId?: string | null; imageUrl?: string | null } | null, source: ImageSource) {
  const key =
    card?.imageId && (source.ownerUid || source.publicSetId)
      ? source.publicSetId
        ? `public/${source.publicSetId}/${card.imageId}`
        : `${source.ownerUid}/${card.imageId}`
      : null
  const [url, setUrl] = useState<string | null>(() => (key ? (cache.get(key) ?? null) : null))
  useEffect(() => {
    if (!key || !card?.imageId) {
      setUrl(null)
      return
    }
    const hit = cache.get(key)
    if (hit) {
      setUrl(hit)
      return
    }
    let cancelled = false
    const ref = source.publicSetId ? publicImageRef(source.publicSetId, card.imageId) : imageRef(source.ownerUid!, card.imageId)
    getDoc(ref)
      .then((snap) => {
        const dataUrl = snap.exists() ? (snap.data().dataUrl as string) : null
        if (dataUrl) cache.set(key, dataUrl)
        if (!cancelled) setUrl(dataUrl)
      })
      .catch(() => !cancelled && setUrl(null))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  if (card?.imageUrl) return card.imageUrl
  return url
}
