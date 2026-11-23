import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiRequestError, friendlyMessage, type BoardStory, type CreateTicketInput } from '../../api/client'
import { useBoard, useCreateTicket, useJiraStatus, useMe, useProject, useStory, useTickets } from '../../api/hooks'
import { pickTab } from './jira'
import { StoriesView } from './StoriesView'

// Container: binds the board, the story picked and the tickets to the view, and makes tickets. The tab and the story are in the address
// (?tab=sent, ?open=R6), so a link opens the right one; the Design step's Story link arrives with ?open. With nothing left to prepare the
// page opens on Sent to Jira; a tab chosen by hand stays chosen.
export function StoriesPage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const project = useProject(projectId)
  const board = useBoard(projectId)
  const tickets = useTickets(projectId)
  const me = useMe()
  const canEdit = me.data?.role === 'owner' || me.data?.role === 'editor'
  const jira = useJiraStatus(canEdit)
  const create = useCreateTicket(projectId)
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | undefined>()
  const [justSent, setJustSent] = useState<{ jiraKey: string; storyKey: string; url: string | null } | null>(null)

  const stories = board.data?.stories ?? []
  const made = tickets.data?.data ?? []
  const sentIds = new Set(made.map((t) => t.storyId))
  const toPrepare = stories.filter((s) => s.kind === 'requirement' && !sentIds.has(s.id))
  // Arriving with ?open=R6: that story is selected on Prepare for Jira, or, if it has been sent, marked on Sent to Jira.
  const wanted = params.get('open')
  const target = wanted ? stories.find((s) => s.key === wanted) : undefined
  const targetSent = !!target && sentIds.has(target.id)
  // Otherwise the first requirement still to prepare, then the first open question, so the page is never empty while there is something on it.
  const firstId = useMemo(() => {
    const byKey = (a: BoardStory, b: BoardStory) => a.key.localeCompare(b.key, undefined, { numeric: true })
    const todo = stories.filter((s) => s.kind === 'requirement' && !sentIds.has(s.id)).sort(byKey)[0]
    const question = stories.filter((s) => s.kind === 'open_question').sort(byKey)[0]
    return (todo ?? question)?.id ?? null
  }, [board.data, tickets.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const [seen, setSeen] = useState<string | null>(null)
  useEffect(() => {
    if (target && !targetSent && seen !== target.key) {
      setSeen(target.key)
      setPickedId(target.id)
    }
  }, [target, targetSent, seen])
  const selectable = [...toPrepare, ...stories.filter((s) => s.kind === 'open_question')]
  const openId = pickedId && selectable.some((s) => s.id === pickedId) ? pickedId : firstId
  const detail = useStory(openId)

  const noBoard = board.error instanceof ApiRequestError && board.error.code === 'no_board'
  // The tab that opens depends on the tickets, so the page waits for them rather than opening on one tab and then changing.
  const state = noBoard ? 'empty' : board.isError ? 'error' : board.isPending || (tickets.isPending && !tickets.isError) ? 'loading' : 'ready'
  const chosen = params.get('tab') ?? (targetSent ? 'sent' : null)
  const tab = pickTab(chosen, toPrepare.length, made.length)

  return (
    <StoriesView
      state={state}
      project={project.data}
      stories={stories}
      tickets={made}
      tab={tab}
      openId={openId}
      detail={openId ? detail.data : undefined}
      canEdit={canEdit}
      jira={jira.data}
      errorText={board.isError && !noBoard ? friendlyMessage(board.error) : tickets.isError ? friendlyMessage(tickets.error) : undefined}
      creating={create.isPending}
      createError={createError}
      justSent={justSent}
      highlightKey={targetSent ? (target?.key ?? null) : null}
      linkTo={(story) => `${window.location.origin}/projects/${projectId}/stories?open=${encodeURIComponent(story.key)}`}
      onTab={(next) => {
        const p = new URLSearchParams(params)
        p.set('tab', next)
        p.delete('open')
        setParams(p, { replace: true })
        setJustSent(null)
      }}
      onOpen={setPickedId}
      onDismissSent={() => setJustSent(null)}
      onCreate={async (storyId: string, input: CreateTicketInput) => {
        setCreateError(undefined)
        try {
          const ticket = await create.mutateAsync({ storyId, input })
          setJustSent({ jiraKey: ticket.jiraKey, storyKey: ticket.storyKey, url: ticket.jiraUrl })
          return true
        } catch (err) {
          setCreateError(friendlyMessage(err))
          return false
        }
      }}
      onGoRequirements={() => navigate(`/projects/${projectId}/requirements`)}
      onViewDesign={(story: BoardStory) => navigate(`/projects/${projectId}/design?open=${encodeURIComponent(story.key)}`)}
    />
  )
}
