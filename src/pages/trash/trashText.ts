import type { TrashItem } from '../../api/client'

export const plural = (n: number, word: string) => `${n} ${n === 1 ? word : /(ch|sh|s|x)$/.test(word) ? `${word}es` : `${word}s`}`

/** What was in a deleted item, in a few words: "4 transcripts · 7 themes". */
export function summaryText(s: TrashItem['summary']): string {
  const parts: string[] = []
  for (const [key, word] of [['participants', 'participant'], ['transcripts', 'transcript'], ['themes', 'theme'], ['requirements', 'requirement'], ['stories', 'story'], ['launches', 'launch']] as const) {
    if (s[key]) parts.push(plural(s[key], word))
  }
  return parts.join(' · ')
}
