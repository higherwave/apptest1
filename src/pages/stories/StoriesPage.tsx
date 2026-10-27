import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiRequestError, friendlyMessage, type BoardStory, type ChecklistInput, type Priority, type StoryStatus } from '../../api/client'
import { useBoard, useMe, useMoveStory, useProject, useSaveChecklist, useStory, useUndoMove } from '../../api/hooks'
import { STATUS_LABEL } from './labels'
import { StoriesView } from './StoriesView'

// Container: binds the board to the view, holds the filters and the open card, and sends moves and edits.
export function StoriesPage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const project = useProject(projectId)
  const board = useBoard(projectId)
  const me = useMe()
  const move = useMoveStory(projectId)
  const undo = useUndoMove(projectId)
  const checklist = useSaveChecklist(projectId)
  const [pickedId, setPickedId] = useState<string | null>(null)
  // The panel always shows a card: the one picked, or else the first in To Do (so it is never empty on arrival).
  const firstId = useMemo(() => {
    const all = board.data?.stories ?? []
    return ([...all].filter((s) => s.status === 'todo').sort((a, b) => a.position - b.position)[0] ?? all[0])?.id ?? null
  }, [board.data])
  const openId = pickedId && board.data?.stories.some((s) => s.id === pickedId) ? pickedId : firstId
  const detail = useStory(openId)
  // Arriving from a requirement's Story link on the Design step: that card is selected, listed even past the first few, and brought into view, once.
  const arrivedAt = useRef<string | null>(null)
  const wanted = params.get('open')
  const target = wanted ? board.data?.stories.find((s) => s.key === wanted) : undefined
  useEffect(() => {
    if (target && arrivedAt.current !== target.key) setPickedId(target.id)
  }, [target])
  useEffect(() => {
    if (!target || arrivedAt.current === target.key || openId !== target.id) return
    arrivedAt.current = target.key
    const card = document.querySelector<HTMLElement>(`[data-testid="card-${target.key}"]`)
    if (!card) return
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    card.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' })
    card.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
  }, [target, openId, board.data])
  const [savedAt, setSavedAt] = useState<string | undefined>()
  const markSaved = () => setSavedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
  const [search, setSearch] = useState('')
  const [priority, setPriority] = useState<Priority | 'all'>('all')
  const [error, setError] = useState<string | undefined>()
  const [announcement, setAnnouncement] = useState('')
  const [moving, setMoving] = useState<Set<string>>(new Set())

  const stories = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (board.data?.stories ?? []).filter(
      (s) => (priority === 'all' || s.priority === priority) && (!q || `${s.key} ${s.title} ${s.ownerTeam ?? ''}`.toLowerCase().includes(q)),
    )
  }, [board.data, search, priority])

  const fail = (err: unknown) => setError(friendlyMessage(err))
  const onMove = (story: BoardStory, status: StoryStatus, beforeId: string | null) => {
    if (moving.has(story.id)) return
    setError(undefined)
    setMoving((m) => new Set(m).add(story.id))
    move.mutate(
      { story, status, beforeId },
      {
        onError: fail,
        onSuccess: () => {
          markSaved()
          setAnnouncement(`${story.key} moved to ${STATUS_LABEL[status]}`)
        },
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
      openId={openId}
      detail={openId ? detail.data : undefined}
      detailBusy={checklist.isPending}
      undoing={undo.isPending}
      saving={moving.size > 0 || checklist.isPending || undo.isPending}
      savedAt={savedAt}
      errorText={board.isError && !noBoard ? friendlyMessage(board.error) : error}
      announcement={announcement}
      onSearch={setSearch}
      onPriority={setPriority}
      onOpen={setPickedId}
      onMove={onMove}
      onUndo={() => {
        setError(undefined)
        if (board.data) undo.mutate(board.data.specId, { onError: fail, onSuccess: markSaved })
      }}
      onChecklist={(items: ChecklistInput[]) => {
        if (!detail.data) return
        setError(undefined)
        checklist.mutate({ id: detail.data.id, version: detail.data.version, items }, { onError: fail, onSuccess: markSaved })
      }}
      onGoRequirements={() => navigate(`/projects/${projectId}/requirements`)}
      onViewDesign={(story) => navigate(`/projects/${projectId}/design?open=${encodeURIComponent(story.key)}`)}
    />
  )
}
