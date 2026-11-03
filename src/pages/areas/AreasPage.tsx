import { Button, Dropdown, InlineNotification, Loading, Modal, OverflowMenu, OverflowMenuItem, Tag, TextInput } from '@carbon/react'
import { useState } from 'react'
import { ApiRequestError, friendlyMessage, type Area } from '../../api/client'
import { useAcceptAreaProposal, useAreaProposals, useAreas, useCreateArea, useDismissAreaProposal, useMe, useMergeArea, useRetireArea, useUpdateArea } from '../../api/hooks'
import { SettingsHeader } from '../settings/SettingsHeader'
import styles from './AreasPage.module.scss'

type Action = { kind: 'edit' | 'merge' | 'retire'; area: Area } | null

const used = (a: Area) => {
  const parts = [
    a.usage.tasks && `${a.usage.tasks} ${a.usage.tasks === 1 ? 'question or task' : 'questions and tasks'}`,
    a.usage.themes && `${a.usage.themes} ${a.usage.themes === 1 ? 'theme' : 'themes'}`,
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : 'Not used yet'
}

// The shared list of feature areas. Everyone reads it, an editor adds one (the duplicate check is in the dialog), and an owner edits,
// merges and retires. Connected: it owns the dialogs' state.
export function AreasPage() {
  const areas = useAreas()
  const me = useMe()
  const update = useUpdateArea()
  const merge = useMergeArea()
  const retire = useRetireArea()
  const create = useCreateArea()
  const proposals = useAreaProposals()
  const accept = useAcceptAreaProposal()
  const dismiss = useDismissAreaProposal()
  const [newName, setNewName] = useState('')
  const [heard, setHeard] = useState<{ existing?: string; similar: string[]; error?: string }>({ similar: [] })
  const [action, setAction] = useState<Action>(null)
  const [name, setName] = useState('')
  const [definition, setDefinition] = useState('')
  const [aliases, setAliases] = useState('')
  const [target, setTarget] = useState<Area | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isOwner = me.data?.role === 'owner'
  const canAdd = isOwner || me.data?.role === 'editor'
  const all = areas.data?.data ?? []
  const live = all.filter((a) => !a.retired)
  const retired = all.filter((a) => a.retired)

  const open = (kind: 'edit' | 'merge' | 'retire', area: Area) => {
    setError(null)
    setTarget(null)
    setName(area.name)
    setDefinition(area.definition ?? '')
    setAliases(area.aliases.join(', '))
    setAction({ kind, area })
  }
  const close = () => setAction(null)
  const run = async () => {
    if (!action) return
    setError(null)
    try {
      if (action.kind === 'edit') await update.mutateAsync({ id: action.area.id, version: action.area.version, body: { name, definition: definition.trim() || null, aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean) } })
      else if (action.kind === 'merge' && target) await merge.mutateAsync({ id: action.area.id, intoId: target.id })
      else if (action.kind === 'retire') await retire.mutateAsync(action.area.id)
      close()
    } catch (err) {
      setError(err instanceof ApiRequestError && err.code === 'duplicate_area' ? `“${err.extra.existing?.name}” is the same area. Merge them instead.` : friendlyMessage(err))
    }
  }
  // Adding by typing, as on a question. The same name (or another name of one) is not added twice; a look-alike is shown and may still be added.
  const add = async (force: boolean) => {
    setHeard({ similar: [] })
    try {
      await create.mutateAsync({ name: newName, definition: null, aliases: [], force })
      setNewName('')
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'duplicate_area') setHeard({ existing: err.extra.existing?.name, similar: [] })
      else if (err instanceof ApiRequestError && err.code === 'similar_area') setHeard({ similar: (err.extra.similar ?? []).map((x: { name: string }) => x.name) })
      else setHeard({ similar: [], error: friendlyMessage(err) })
    }
  }
  const busy = update.isPending || merge.isPending || retire.isPending

  return (
    <div className={styles.page}>
      <SettingsHeader
        title="Feature areas"
        description="What research is about, in one shared set of words. A question to ask or a task to observe names its area, so what people say is described the same way across studies and duplicates are caught early. An area is a label, never a requirement."
      />
      <div className={styles.layout} data-split={(canAdd && (proposals.data?.length ?? 0) > 0)}>
        <div className={styles.list}>
      {canAdd && (
        <div className={styles.add}>
          <div className={styles.addRow}>
            <TextInput
              id="add-area-name"
              labelText="Add an area"
              placeholder="Type a name, for example Scheduling"
              helperText="It joins the list for everyone. Questions can also add one as you type."
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value)
                setHeard({ similar: [] })
              }}
              onKeyDown={(e) => e.key === 'Enter' && newName.trim().length >= 2 && !create.isPending && void add(false)}
            />
            <Button kind="primary" size="md" disabled={newName.trim().length < 2 || create.isPending} onClick={() => void add(false)}>
              Add
            </Button>
          </div>
          {heard.existing && <InlineNotification kind="warning" lowContrast hideCloseButton title="Already on the list" subtitle={`“${heard.existing}” is the same area.`} />}
          {heard.similar.length > 0 && (
            <div className={styles.found} data-testid="area-similar">
              <InlineNotification kind="info" lowContrast hideCloseButton title="This looks like an area you have" subtitle={`${heard.similar.map((n) => `“${n}”`).join(' and ')} may already cover it.`} />
              <Button kind="tertiary" size="sm" onClick={() => void add(true)}>
                Add it anyway
              </Button>
            </div>
          )}
          {heard.error && <InlineNotification kind="error" lowContrast hideCloseButton title="Not added" subtitle={heard.error} />}
        </div>
      )}
      {areas.isPending && <Loading small withOverlay={false} description="Loading the feature areas" />}
      {areas.isError && <InlineNotification kind="error" lowContrast hideCloseButton title="Could not load the areas" subtitle={friendlyMessage(areas.error)} />}
      {areas.isSuccess && live.length === 0 && <p className={styles.empty}>No feature areas yet. Add the first one, or type one in the Feature area box on a question in a task list.</p>}
      {live.length > 0 && (
        <div className={styles.tableWrap}>
          <div className={styles.table} role="table" aria-label="Feature areas">
            <div className={styles.row} role="row">
              {['Area', 'Other names', 'Used by'].map((h) => (
                <div key={h} className={styles.head} role="columnheader">
                  {h}
                </div>
              ))}
              <div className={styles.head} role="columnheader">
                <span className={styles.srOnly}>Actions</span>
              </div>
            </div>
            {live.map((a) => (
              <div key={a.id} className={styles.row} role="row" data-testid={`area-${a.name}`}>
                <div role="cell">
                  <p className={styles.name}>{a.name}</p>
                  {a.definition && <p className={styles.definition}>{a.definition}</p>}
                </div>
                <div role="cell" className={styles.tags}>
                  {a.aliases.map((x) => (
                    <Tag key={x} size="sm" type="gray">
                      {x}
                    </Tag>
                  ))}
                </div>
                <div role="cell" className={styles.used}>
                  {used(a)}
                </div>
                <div role="cell" className={styles.actions}>
                  {isOwner && (
                    <OverflowMenu iconDescription={`Actions for ${a.name}`} flipped size="sm">
                      <OverflowMenuItem itemText="Edit" onClick={() => open('edit', a)} />
                      <OverflowMenuItem itemText="Merge into another area" disabled={live.length < 2} onClick={() => open('merge', a)} />
                      <OverflowMenuItem itemText="Retire" isDelete onClick={() => open('retire', a)} />
                    </OverflowMenu>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {retired.length > 0 && (
        <section aria-label="Retired areas" className={styles.retired}>
          <h2 className={styles.retiredHead}>Retired</h2>
          <p className={styles.definition}>
            {retired.map((a) => (a.mergedInto ? `${a.name} (merged into ${all.find((x) => x.id === a.mergedInto)?.name ?? 'another area'})` : a.name)).join(' · ')}
          </p>
        </section>
      )}

        </div>
      {canAdd && (proposals.data?.length ?? 0) > 0 && (
        <section className={styles.proposals} aria-label="Suggested areas" data-testid="area-proposals">
          <h2 className={styles.retiredHead}>Suggested areas</h2>
          <p className={styles.definition}>Themes with no area keep coming back around these words. Add one and its themes are filed under it for everyone.</p>
          {proposals.data!.map((p) => (
            <div key={p.key} className={styles.proposal} data-testid={`area-proposal-${p.name}`}>
              <div>
                <p className={styles.name}>{p.name}</p>
                <p className={styles.definition}>
                  {p.themes.length} themes · {p.participants} participants · {p.projects} {p.projects === 1 ? 'project' : 'projects'}
                </p>
                <p className={styles.definition}>{p.themes.slice(0, 4).map((t) => t.title).join(' · ')}{p.themes.length > 4 ? ` · and ${p.themes.length - 4} more` : ''}</p>
              </div>
              <div className={styles.proposalActions}>
                <Button kind="primary" size="sm" disabled={accept.isPending || dismiss.isPending} onClick={() => accept.mutate({ key: p.key })}>
                  Add area
                </Button>
                <Button kind="ghost" size="sm" disabled={accept.isPending || dismiss.isPending} onClick={() => dismiss.mutate(p.key)}>
                  Not now
                </Button>
              </div>
            </div>
          ))}
          {accept.isError && <InlineNotification kind="error" lowContrast hideCloseButton title="Not added" subtitle={friendlyMessage(accept.error)} />}
        </section>
      )}
      </div>

      <Modal
        open={action?.kind === 'edit'}
        size="sm"
        modalHeading={`Edit ${action?.area.name ?? 'area'}`}
        primaryButtonText={busy ? 'Saving…' : 'Save'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={name.trim().length < 2 || busy}
        onRequestClose={close}
        onRequestSubmit={() => void run()}
      >
        <div className={styles.form}>
          <TextInput id="edit-area-name" labelText="Name" value={name} onChange={(e) => setName(e.target.value)} helperText="A new name keeps the old one as another name, so it is still recognised." />
          <TextInput id="edit-area-definition" labelText="What is in this area" value={definition} onChange={(e) => setDefinition(e.target.value)} />
          <TextInput id="edit-area-aliases" labelText="Other names people use" helperText="Separate with commas" value={aliases} onChange={(e) => setAliases(e.target.value)} />
          {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Not saved" subtitle={error} />}
        </div>
      </Modal>

      <Modal
        open={action?.kind === 'merge'}
        size="sm"
        modalHeading={`Merge ${action?.area.name ?? 'area'} into another area`}
        primaryButtonText={busy ? 'Merging…' : 'Merge'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={!target || busy}
        onRequestClose={close}
        onRequestSubmit={() => void run()}
      >
        <div className={styles.form}>
          <p className={styles.confirm}>Everything that uses {action?.area.name} moves to the area you choose, and {action?.area.name} becomes another name for it.</p>
          <Dropdown
            id="merge-area-target"
            titleText="Merge into"
            label="Choose an area"
            items={live.filter((a) => a.id !== action?.area.id)}
            itemToString={(a: Area | null) => a?.name ?? ''}
            selectedItem={target}
            onChange={({ selectedItem }: { selectedItem?: Area | null }) => setTarget(selectedItem ?? null)}
          />
          {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Not merged" subtitle={error} />}
        </div>
      </Modal>

      <Modal
        open={action?.kind === 'retire'}
        danger
        size="sm"
        modalHeading={`Retire ${action?.area.name ?? 'area'}?`}
        primaryButtonText={busy ? 'Retiring…' : 'Retire'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={busy}
        onRequestClose={close}
        onRequestSubmit={() => void run()}
      >
        <p className={styles.confirm}>It leaves the list people choose from. Questions, tasks and test items that already use it keep it. To combine it with another area instead, use Merge.</p>
        {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Not retired" subtitle={error} />}
      </Modal>
    </div>
  )
}
