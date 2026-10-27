// Turns a picked screenshot into a small picture to keep: at most 960 px wide, as JPEG, sent as base64. A prototype's thumbnail
// does not need more, and it keeps each row of the database small.
const MAX_WIDTH = 960
const MAX_INPUT_BYTES = 15 * 1024 * 1024

export type Thumbnail = { type: 'image/jpeg'; data: string }

export async function makeThumbnail(file: File): Promise<Thumbnail> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file (PNG, JPEG or WebP).')
  if (file.size > MAX_INPUT_BYTES) throw new Error('That picture is larger than 15 MB. Choose a smaller one.')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('That picture could not be read. Try a PNG, JPEG or WebP.')
  }
  const scale = Math.min(1, MAX_WIDTH / bitmap.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot prepare the picture.')
  ctx.fillStyle = '#ffffff' // a transparent PNG becomes white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
  if (!blob) throw new Error('This browser cannot prepare the picture.')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { type: 'image/jpeg', data: btoa(binary) }
}
