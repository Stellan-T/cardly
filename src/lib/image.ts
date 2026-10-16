/** Client-side image resize + compression (Firebase Storage needs the paid plan, so images go in Firestore). */

export const MAX_IMAGE_DIMENSION = 800
export const MAX_IMAGE_BYTES = 150 * 1024
/** Refuse absurdly large source files before decoding them. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024

export interface CompressedImage {
  dataUrl: string
  width: number
  height: number
  bytes: number
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('This file could not be read as an image.'))
    }
    img.src = url
  })
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

/** Resizes to at most 800px and compresses to WebP (or JPEG) of at most 150 KB. */
export async function compressImage(file: Blob): Promise<CompressedImage> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.')
  if (file.size > MAX_SOURCE_BYTES) throw new Error('That image is too large (over 25 MB). Please pick a smaller one.')
  const img = await loadImage(file)
  let scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Your browser cannot process images.')
  for (let attempt = 0; attempt < 6; attempt++) {
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.85, 0.7, 0.55, 0.4]) {
      let blob = await toBlob(canvas, 'image/webp', quality)
      if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', quality)
      if (blob && blob.size <= MAX_IMAGE_BYTES) {
        return { dataUrl: await blobToDataUrl(blob), width: canvas.width, height: canvas.height, bytes: blob.size }
      }
    }
    scale *= 0.75
  }
  throw new Error('This image is too detailed to fit in 150 KB even after shrinking. Try a simpler image or paste an image URL instead.')
}
