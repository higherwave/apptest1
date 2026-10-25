export const PLATFORM_LABEL: Record<string, string> = { zoom: 'Zoom', meet: 'Google Meet', teams: 'Microsoft Teams' }
// The short names on the tabs and the tags, and the longer ones in "Drop … transcripts here".
export const PLATFORM_SHORT: Record<string, string> = { zoom: 'Zoom', meet: 'Meet', teams: 'Teams' }
export const PLATFORM_DROP: Record<string, string> = { zoom: 'Zoom', meet: 'Google Meet', teams: 'MS Teams' }
export const ACCEPTED_FILES = ['.vtt', '.txt', '.sbv', '.srt']
// The file type each tool usually exports; the drop zone names it and still accepts the others.
export const PLATFORM_FILES: Record<string, string[]> = { zoom: ['.vtt'], meet: ['.txt', '.sbv'], teams: ['.vtt'] }
