import type { StoryStatus } from '../../api/client'

export const STATUS_LABEL: Record<StoryStatus, string> = { todo: 'To Do', in_progress: 'In progress', in_review: 'In review', done: 'Done' }
