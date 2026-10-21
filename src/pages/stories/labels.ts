import type { StoryStatus } from '../../api/client'

export const STATUS_LABEL: Record<StoryStatus, string> = { todo: 'To Do', in_progress: 'In progress', in_review: 'In review', done: 'Done' }

// One line under each column's name, saying what belongs there.
export const STATUS_HINT: Record<StoryStatus, string> = {
  todo: 'Requirements and open questions from the published document.',
  in_progress: 'In build, owner assigned, with collaborative reviews.',
  in_review: 'Built, checking against participant tasks.',
  done: 'Shipped and verified.',
}
