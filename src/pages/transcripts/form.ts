import type { TranscriptList } from '../../api/client'

// Form state for the transcript list. `key` only identifies a row on screen; `id` is the saved transcript's id.
export type Platform = 'zoom' | 'meet' | 'teams'
export type TranscriptItem = { key: string; id: string | null; name: string; platform: Platform | null; rawText: string }
export type TranscriptErrors = Record<number, { name?: string; rawText?: string }>

let counter = 0
export const newKey = () => `t${++counter}`

export const formFromList = (list: TranscriptList): TranscriptItem[] =>
  list.transcripts.map((t) => ({ key: newKey(), id: t.id, name: t.name, platform: t.platform as Platform | null, rawText: t.rawText }))

const signature = (items: { id: string | null; name: string; platform: string | null; rawText: string }[]) =>
  JSON.stringify(items.map((t) => [t.id, t.name.trim(), t.platform, t.rawText]))

export const itemsChanged = (items: TranscriptItem[], saved: TranscriptList) => signature(items) !== signature(saved.transcripts)

export function validateItems(items: TranscriptItem[]): TranscriptErrors {
  const errors: TranscriptErrors = {}
  items.forEach((t, i) => {
    if (!t.name.trim()) errors[i] = { ...errors[i], name: 'Enter a name.' }
    if (!t.rawText.trim()) errors[i] = { ...errors[i], rawText: 'Paste or upload the transcript text.' }
  })
  return errors
}

export const toRequest = (items: TranscriptItem[]) => ({
  transcripts: items.map((t) => ({ id: t.id, name: t.name.trim(), platform: t.platform, rawText: t.rawText })),
})

// A server error such as "transcripts.2.rawText" becomes an error on that row.
export function errorFromField(field: string | undefined, message: string): TranscriptErrors {
  const m = field?.match(/^transcripts\.(\d+)\.(name|rawText)$/)
  return m ? { [Number(m[1])]: { [m[2]]: message } } : {}
}

export function fileToItem(name: string, text: string): TranscriptItem {
  return { key: newKey(), id: null, name, platform: null, rawText: text }
}
