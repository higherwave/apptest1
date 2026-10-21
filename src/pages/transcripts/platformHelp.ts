// How to get a transcript out of each meeting tool, shown beside the upload.
export const PLATFORM_HELP: { key: 'zoom' | 'meet' | 'teams'; name: string; text: string }[] = [
  { key: 'zoom', name: 'Zoom', text: 'After the meeting, open Recordings, then download the audio transcript (.vtt) from the cloud recording.' },
  { key: 'meet', name: 'Google Meet', text: 'Transcripts save to the organizer’s Drive as a Doc. Download it as .txt, or use a captions export (.sbv).' },
  { key: 'teams', name: 'Microsoft Teams', text: 'In the meeting recap, choose Transcript, then Download as .vtt.' },
]

export const PLATFORM_LABEL: Record<string, string> = { zoom: 'Zoom', meet: 'Google Meet', teams: 'Microsoft Teams' }
export const ACCEPTED_FILES = ['.vtt', '.txt', '.sbv', '.srt']
