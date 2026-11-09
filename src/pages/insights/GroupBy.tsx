import { Button, Dropdown } from '@carbon/react'
import { useSearchParams } from 'react-router-dom'
import styles from './GroupBy.module.scss'

export type Grouping = 'none' | 'area'

/** The grouping, kept in the address (?group=area) so a link shares the view. None unless asked for. */
export function useGrouping(): [Grouping, (g: Grouping) => void] {
  const [params, setParams] = useSearchParams()
  const set = (g: Grouping) => {
    const next = new URLSearchParams(params)
    if (g === 'area') next.set('group', 'area')
    else next.delete('group')
    setParams(next, { replace: true })
  }
  return [params.get('group') === 'area' ? 'area' : 'none', set]
}

// The Group by choice shared by the Platform Insights pages: None (the default) or Experience category.
const CHOICES: { key: Grouping; label: string }[] = [
  { key: 'none', label: 'None' },
  { key: 'area', label: 'Experience category' },
]

// `compact` is the same choice as a dropdown, for a toolbar with other dropdowns beside it.
export function GroupBy({ value, onChange, compact = false }: { value: Grouping; onChange: (g: Grouping) => void; compact?: boolean }) {
  if (compact) {
    return (
      <div className={styles.compact} data-testid="group-by">
        <Dropdown
          id="group-by"
          titleText="Group by"
          label="Group by"
          size="md"
          items={CHOICES}
          itemToString={(i) => i?.label ?? ''}
          selectedItem={CHOICES.find((c) => c.key === value)}
          onChange={({ selectedItem }) => selectedItem && onChange(selectedItem.key)}
        />
      </div>
    )
  }
  return (
    <div className={styles.group} role="group" aria-label="Group the themes">
      <span className={styles.label}>Group by</span>
      {([['none', 'None'], ['area', 'Experience category']] as const).map(([key, label]) => (
        <Button key={key} kind={value === key ? 'primary' : 'ghost'} size="sm" aria-pressed={value === key} data-testid={`group-${key}`} onClick={() => onChange(key)}>
          {label}
        </Button>
      ))}
    </div>
  )
}
