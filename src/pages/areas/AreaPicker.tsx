import { Button, ComboBox } from '@carbon/react'
import { useState } from 'react'
import { similarAreas, suggestAreas } from '../../../shared/areas'
import { ApiRequestError, friendlyMessage, type Area } from '../../api/client'
import { useAreas, useCreateArea, useMe } from '../../api/hooks'
import styles from './AreaPicker.module.scss'

// Chooses the feature area a question to ask, task to observe or theme is about. It is optional: an area helps the system file what people
// say, but nothing depends on one, and a team in discovery may not know what to call a feature yet. Pick one from the list, or type a
// new name and choose "Add": it joins the list for everyone. Names that look like an existing area are listed first, so a near-duplicate
// is easy to avoid and never forced. When the text beside it clearly concerns an area, that one is offered. Connected: it reads the shared list itself.
type Item = Area | { id: '__new__'; name: string; create: true }
const isNew = (i: Item | null | undefined): i is { id: '__new__'; name: string; create: true } => !!i && 'create' in i

export function AreaPicker({ id, label, value, onChange, readOnly, about }: { id: string; label: string; value: string | null; onChange: (areaId: string | null) => void; readOnly?: boolean; about?: string }) {
  const areas = useAreas()
  const me = useMe()
  const create = useCreateArea()
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const all = areas.data?.data ?? []
  const live = all.filter((a) => !a.retired)
  const selected = all.find((a) => a.id === value) ?? null
  const canAdd = !readOnly && (me.data?.role === 'owner' || me.data?.role === 'editor')

  // What is typed filters the list; the name of the chosen area sitting in the box is not a search.
  const q = typed.trim() === selected?.name ? '' : typed.trim()
  const lower = q.toLowerCase()
  const exact = q ? similarAreas(q, live).find((s) => s.reason !== 'similar')?.area : undefined
  const related: Area[] = q
    ? [...new Map([...live.filter((a) => [a.name, ...a.aliases].some((n) => n.toLowerCase().includes(lower))), ...similarAreas(q, live).map((s) => s.area as Area)].map((a) => [a.id, a])).values()]
    : live
  const items: Item[] = [...(selected && selected.retired ? [selected] : []), ...related, ...(canAdd && q.length >= 2 && !exact ? [{ id: '__new__' as const, name: q, create: true as const }] : [])]
  const suggestion = !readOnly && !value && about && about.trim().length >= 10 ? suggestAreas(about, live)[0]?.area : undefined

  const choose = async (item: Item | null | undefined) => {
    setError(null)
    if (!isNew(item)) return onChange(item?.id ?? null)
    try {
      // Typing a name and choosing "Add" is the person's decision, so a look-alike does not stop it (force); the same name does not add twice.
      const area = await create.mutateAsync({ name: item.name, definition: null, aliases: [], force: true })
      setTyped(area.name)
      onChange(area.id)
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'duplicate_area' && err.extra.existing?.id) onChange(err.extra.existing.id)
      else setError(friendlyMessage(err))
    }
  }

  return (
    <div className={styles.picker}>
      <ComboBox
        id={id}
        titleText={label}
        placeholder={canAdd ? 'Choose an area, or type a new one (optional)' : 'Choose an area (optional)'}
        items={items}
        itemToString={(a: Item | null) => (a ? (isNew(a) ? a.name : a.retired ? `${a.name} (retired)` : a.name) : '')}
        itemToElement={(a: Item) => (isNew(a) ? <span data-testid={`${id}-add`}>Add “{a.name}” as a new area</span> : <span>{a.name}</span>)}
        selectedItem={selected}
        onChange={({ selectedItem }: { selectedItem?: Item | null }) => void choose(selectedItem)}
        onInputChange={(text: string) => setTyped(text ?? '')}
        shouldFilterItem={() => true}
        helperText={canAdd ? 'A new name is added to the list for everyone.' : undefined}
        invalid={!!error}
        invalidText={error ?? undefined}
        readOnly={readOnly || create.isPending}
        size="md"
      />
      {suggestion && (
        <p className={styles.suggestion} data-testid={`${id}-suggestion`}>
          Sounds like <strong>{suggestion.name}</strong>.
          <Button kind="ghost" size="sm" onClick={() => onChange(suggestion.id)}>
            Use it
          </Button>
        </p>
      )}
    </div>
  )
}
