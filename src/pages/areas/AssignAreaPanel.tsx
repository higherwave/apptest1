import { Button, InlineNotification, Search } from '@carbon/react'
import { useState } from 'react'
import { similarAreas } from '../../../shared/areas'
import { ApiRequestError, friendlyMessage, type Area } from '../../api/client'
import { useAreas, useCreateArea, useMe } from '../../api/hooks'
import { RightPanel } from '../../components/RightPanel'
import styles from './AssignAreaPanel.module.scss'

// Files a theme that has no feature area. Choose one from the list (search by name or another name), or type a new name and choose
// "Add": it joins the list for everyone and the theme is filed under it. Names that look like an existing area are listed first, and the
// same name is never added twice. Choosing closes the panel.
export function AssignAreaPanel({ open, themeTitle, onClose, onChoose }: { open: boolean; themeTitle: string; onClose: () => void; onChoose: (areaId: string) => void }) {
  const areas = useAreas()
  const me = useMe()
  const create = useCreateArea()
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const q = query.trim()
  const lower = q.toLowerCase()
  const live = (areas.data?.data ?? []).filter((a) => !a.retired)
  const matched: Area[] = q
    ? [...new Map([...live.filter((a) => [a.name, ...a.aliases].some((n) => n.toLowerCase().includes(lower))), ...similarAreas(q, live).map((s) => s.area as Area)].map((a) => [a.id, a])).values()]
    : live
  const exact = q ? similarAreas(q, live).find((s) => s.reason !== 'similar')?.area : undefined
  const canAdd = me.data?.role === 'owner' || me.data?.role === 'editor'
  const done = (areaId: string) => {
    setQuery('')
    setError(null)
    onChoose(areaId)
  }
  const close = () => {
    setQuery('')
    setError(null)
    onClose()
  }
  const add = async () => {
    setError(null)
    try {
      // Typing a name and choosing "Add" is the person's decision, so a look-alike does not stop it; the same name is not added twice.
      done((await create.mutateAsync({ name: q, definition: null, aliases: [], force: true })).id)
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'duplicate_area' && err.extra.existing?.id) done(err.extra.existing.id)
      else setError(friendlyMessage(err))
    }
  }
  // Enter does what the top choice would: the area typed if it exists, else add it (when allowed), else the only match.
  const enter = () => {
    if (!q) return
    if (exact) done(exact.id)
    else if (canAdd && q.length >= 2 && !create.isPending) void add()
    else if (matched.length === 1) done(matched[0].id)
  }
  return (
    <RightPanel open={open} heading="Add to Feature Area" label={themeTitle} focus="input.cds--search-input" onClose={close}>
      <div className={styles.body} data-testid="assign-area-panel">
        <Search size="md" labelText="Search or add a feature area" placeholder="Search, or type a new area" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') enter() }} />
        {areas.isSuccess && live.length === 0 && !q && <p className={styles.empty}>There are no feature areas yet. Type a name to add the first one.</p>}
        {q && matched.length === 0 && !canAdd && <p className={styles.empty}>No feature area matches “{q}”.</p>}
        <ul className={styles.list} aria-label="Feature areas">
          {matched.map((a) => (
            <li key={a.id}>
              <Button kind="ghost" size="md" className={styles.choice} data-testid={`choose-area-${a.name}`} onClick={() => done(a.id)}>
                <span className={styles.choiceText}>
                  <span className={styles.name}>{a.name}</span>
                  {a.definition && <span className={styles.definition}>{a.definition}</span>}
                </span>
              </Button>
            </li>
          ))}
          {canAdd && q.length >= 2 && !exact && (
            <li>
              <Button kind="ghost" size="md" className={styles.choice} disabled={create.isPending} data-testid="add-area-option" onClick={() => void add()}>
                <span className={styles.choiceText}>
                  <span className={styles.name}>Add “{q}”</span>
                  <span className={styles.definition}>A new area for everyone, and file this theme under it</span>
                </span>
              </Button>
            </li>
          )}
        </ul>
        {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Not added" subtitle={error} />}
      </div>
    </RightPanel>
  )
}
