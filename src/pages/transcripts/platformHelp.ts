// How to get a transcript out of each meeting tool, shown beside the upload.
export const PLATFORM_HELP: { key: 'zoom' | 'meet' | 'teams'; name: string; text: string }[] = [
  { key: 'zoom', name: 'Zoom', text: 'after the meeting, open Recordings, then download the audio transcript (.vtt) from the cloud recording.' },
  { key: 'meet', name: 'Google Meet', text: 'transcripts save to the organizer’s Drive as a Doc. Download it as .txt, or use a captions export (.sbv).' },
  { key: 'teams', name: 'Microsoft Teams', text: 'in the meeting recap, choose Transcript, then Download as .vtt.' },
]

export const PLATFORM_LABEL: Record<string, string> = { zoom: 'Zoom', meet: 'Google Meet', teams: 'Microsoft Teams' }
// The short names on the tabs and the tags, and the longer ones in "Drop … transcripts here".
export const PLATFORM_SHORT: Record<string, string> = { zoom: 'Zoom', meet: 'Meet', teams: 'Teams' }
export const PLATFORM_DROP: Record<string, string> = { zoom: 'Zoom', meet: 'Google Meet', teams: 'MS Teams' }
export const ACCEPTED_FILES = ['.vtt', '.txt', '.sbv', '.srt']
