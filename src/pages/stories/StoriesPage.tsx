import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiRequestError, friendlyMessage, type BoardStory, type ChecklistInput, type Priority, type StoryStatus } from '../../api/client'
import { useBoard, useMe, useMoveStory, usePatchStory, useProject, useSaveChecklist, useStory, useUndoMove } from '../../api/hooks'
import { StoriesView } from './StoriesView'

// Container: binds the board to the view, holds the filters and the open card, and sends moves and edits.
export function StoriesPage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const project = useProject(projectId)
  const board = useBoard(projectId)
  const me = useMe()
  const move = useMoveStory(projectId)
  const undo = useUndoMove(projectId)
  const patch = usePatchStory(projectId)
  const checklist = useSaveChecklist(projectId)
  const [openId, setOpenId] = useState<string | null>(null)
  const detail = useStory(openId)
  const [search, setSearch] = useState('')
  const [priority, setPriority] = useState<Priority | 'all'>('all')
  const [themeId, setThemeId] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [moving, setMoving] = useState<Set<string>>(new Set())

  const stories = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (board.data?.stories ?? []).filter(
      (s) => (priority === 'all' || s.priority === priority) && (!themeId || s.theme?.id === themeId) && (!q || `${s.key} ${s.title} ${s.ownerTeam ?? ''}`.toLowerCase().includes(q)),
    )
  }, [board.data, search, priority, themeId])

  const fail = (err: unknown) => setError(friendlyMessage(err))
  const onMove = (story: BoardStory, status: StoryStatus, beforeId: string | null) => {
    if (moving.has(story.id)) return
    setError(undefined)
    setMoving((m) => new Set(m).add(story.id))
    move.mutate(
      { story, status, beforeId },
      {
        onError: fail,
        onSettled: () => setMoving((m) => { const n = new Set(m); n.delete(story.id); return n }),
      },
    )
  }

  const noBoard = board.error instanceof ApiRequestError && board.error.code === 'no_board'
  const state = noBoard ? 'empty' : board.isError ? 'error' : board.isPending ? 'loading' : 'ready'

  return (
    <StoriesView
      state={state}
      project={project.data}
      board={board.data}
      stories={stories}
      canEdit={me.data?.role === 'owner' || me.data?.role === 'editor'}
      moving={moving}
      search={search}
      priority={priority}
      themeId={themeId}
      openId={openId}
      detail={openId ? detail.data : undefined}
      detailBusy={patch.isPending || checklist.isPending}
      undoing={undo.isPending}
      errorText={board.isError && !noBoard ? friendlyMessage(board.error) : error}
      onSearch={setSearch}
      onPriority={setPriority}
      onTheme={setThemeId}
      onOpen={setOpenId}
      onClose={() => setOpenId(null)}
      onMove={onMove}
      onUndo={() => {
        setError(undefined)
        if (board.data) undo.mutate(board.data.specId, { onError: fail })
      }}
      onPatch={(body) => {
        if (!detail.data) return
        setError(undefined)
        patch.mutate({ id: detail.data.id, version: detail.data.version, body }, { onError: fail })
      }}
      onChecklist={(items: ChecklistInput[]) => {
        if (!detail.data) return
        setError(undefined)
        checklist.mutate({ id: detail.data.id, version: detail.data.version, items }, { onError: fail })
      }}
      onGoRequirements={() => navigate(`/projects/${projectId}/requirements`)}
    />
  )
}
