import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { friendlyMessage } from '../../api/client'
import { useAddSampleWorkflows, useCreateWorkflow, useDeleteWorkflow, useMe, usePlatformJourney, useSaveWorkflow, useWorkflows } from '../../api/hooks'
import { BlueprintEditor } from './BlueprintEditor'
import { blankDraft, fromWorkflow, toRequest, type Draft } from './blueprintDraft'
import { ALL, PlatformJourneyView } from './PlatformJourneyView'

// Container: the platform journey. Which workflow shows is in the address (`?workflow=<id>` or `?workflow=all`); with none chosen it opens on the
// first workflow that has a project on it, else the first, else every study folded by stage name. Owners and editors edit the blueprint here.
export function PlatformJourneyPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const me = useMe()
  const canEdit = me.data?.role === 'owner' || me.data?.role === 'editor'
  const workflows = useWorkflows()
  const list = workflows.data?.data ?? []
  const wanted = params.get('workflow')
  const selected = wanted === ALL ? ALL : (list.find((w) => w.id === wanted) ?? (wanted ? undefined : (list.find((w) => w.projectCount > 0) ?? list[0])))?.id ?? ALL
  const journey = usePlatformJourney(workflows.isPending ? undefined : selected === ALL ? undefined : selected)
  const [persona, setPersona] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const sample = useAddSampleWorkflows()
  const create = useCreateWorkflow()
  const save = useSaveWorkflow()
  const remove = useDeleteWorkflow()

  const choose = (id: string) => {
    setPersona(null)
    setParams({ workflow: id })
  }
  const failure = [create, save, remove].find((m) => m.isError)?.error
  const loading = workflows.isPending || journey.isPending
  const state = journey.isError ? 'error' : loading ? 'loading' : selected === ALL && (journey.data?.stages ?? []).length === 0 ? 'empty' : 'ready'
  const current = list.find((w) => w.id === selected)

  const editor = draft && (
    <BlueprintEditor
      key={`${draft.id ?? 'new'}:${draft.version}`}
      initial={draft}
      projectCount={current?.projectCount ?? 0}
      saving={create.isPending || save.isPending}
      errorText={failure ? friendlyMessage(failure) : undefined}
      onCancel={() => {
        create.reset()
        save.reset()
        remove.reset()
        setDraft(null)
      }}
      onSave={(d) => {
        const done = () => setDraft(null)
        if (d.id) save.mutate({ id: d.id, version: d.version, body: toRequest(d) }, { onSuccess: done })
        else create.mutate(toRequest(d), { onSuccess: (w) => { done(); choose(w.id) } })
      }}
      onDelete={draft.id ? () => remove.mutate(draft.id!, { onSuccess: () => { setDraft(null); setParams({}) } }) : undefined}
      deleting={remove.isPending}
    />
  )

  return (
    <PlatformJourneyView
      state={state}
      journey={journey.data}
      errorText={journey.isError ? friendlyMessage(journey.error) : workflows.isError ? friendlyMessage(workflows.error) : sample.isError ? friendlyMessage(sample.error) : undefined}
      onOpenTheme={(id) => navigate(`/insights/themes?theme=${id}`)}
      workflows={list}
      selected={selected}
      onSelect={choose}
      canEdit={canEdit}
      onEdit={() => current && setDraft(fromWorkflow(current))}
      onNew={() => setDraft(blankDraft())}
      sampleMissing={workflows.data?.sampleMissing ?? false}
      onAddSamples={() => sample.mutate(undefined, { onSuccess: ({ data }) => choose(data.find((w) => w.projectCount > 0)?.id ?? data[0]?.id ?? ALL) })}
      addingSamples={sample.isPending}
      persona={persona}
      onPersona={setPersona}
      editor={editor}
    />
  )
}
