import { Button, ComboBox } from '@carbon/react'
import { useState } from 'react'
import { suggestAreas } from '../../../shared/areas'
import type { Area } from '../../api/client'
import { useAreas, useMe } from '../../api/hooks'
import { NewAreaDialog } from './NewAreaDialog'
import styles from './AreaPicker.module.scss'

// Chooses the feature area a question to ask, task to observe or test item is about. It is optional (an area is a label, never a gate),
// searchable by name and by the other names people use, and, when the text beside it clearly concerns an area, offers that one. An
// editor who finds nothing suitable adds one through the dialog, which checks for duplicates. Connected: it reads the shared list itself.
export function AreaPicker({ id, label, value, onChange, readOnly, about }: { id: string; label: string; value: string | null; onChange: (areaId: string | null) => void; readOnly?: boolean; about?: string }) {
  const areas = useAreas()
  const me = useMe()
  const [adding, setAdding] = useState(false)
  const all = areas.data?.data ?? []
  const choices = all.filter((a) => !a.retired || a.id === value)
  const selected = choices.find((a) => a.id === value) ?? null
  const canAdd = !readOnly && (me.data?.role === 'owner' || me.data?.role === 'editor')
  const suggestion = !readOnly && !value && about && about.trim().length >= 10 ? suggestAreas(about, all.filter((a) => !a.retired))[0]?.area : undefined
  const matches = ({ item, inputValue }: { item: Area | null; inputValue: string | null }) => {
    const q = (inputValue ?? '').trim().toLowerCase()
    return !q || !item || [item.name, ...item.aliases].some((n) => n.toLowerCase().includes(q))
  }

  return (
    <div className={styles.picker}>
      <div className={styles.row}>
        <div className={styles.field}>
          <ComboBox
            id={id}
            titleText={label}
            placeholder={all.length === 0 && !areas.isPending ? 'No feature areas yet' : 'Choose an area (optional)'}
            items={choices}
            itemToString={(a: Area | null) => (a ? (a.retired ? `${a.name} (retired)` : a.name) : '')}
            selectedItem={selected}
            onChange={({ selectedItem }: { selectedItem?: Area | null }) => onChange(selectedItem?.id ?? null)}
            shouldFilterItem={matches}
            readOnly={readOnly}
            size="md"
          />
        </div>
        {canAdd && (
          <Button kind="ghost" size="md" onClick={() => setAdding(true)} data-testid={`${id}-new`}>
            New area
          </Button>
        )}
      </div>
      {suggestion && (
        <p className={styles.suggestion} data-testid={`${id}-suggestion`}>
          Sounds like <strong>{suggestion.name}</strong>.
          <Button kind="ghost" size="sm" onClick={() => onChange(suggestion.id)}>
            Use it
          </Button>
        </p>
      )}
      {canAdd && adding && (
        <NewAreaDialog
          id={`${id}-dialog`}
          open
          onClose={() => setAdding(false)}
          onDone={(area) => {
            setAdding(false)
            onChange(area.id)
          }}
        />
      )}
    </div>
  )
}
