import { Button, Modal, Search } from '@carbon/react'
import { useState } from 'react'
import { useAreas } from '../../api/hooks'
import styles from './AssignAreaPanel.module.scss'

// A panel that slides in from the right with the feature areas, for filing a theme that has none. Choosing one closes it. It scales to a long list
// (it searches by name and other names) where an inline box would not, and it only lists areas that exist: new ones come from the Feature areas page.
export function AssignAreaPanel({ open, themeTitle, onClose, onChoose }: { open: boolean; themeTitle: string; onClose: () => void; onChoose: (areaId: string) => void }) {
  const areas = useAreas()
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const live = (areas.data?.data ?? []).filter((a) => !a.retired)
  const shown = q ? live.filter((a) => [a.name, ...a.aliases].some((n) => n.toLowerCase().includes(q))) : live
  const close = () => {
    setQuery('')
    onClose()
  }
  return (
    <Modal className={styles.panel} open={open} passiveModal size="sm" modalLabel={themeTitle} modalHeading="Add to Feature Area" onRequestClose={close}>
      <div className={styles.body} data-testid="assign-area-panel">
        <Search size="md" labelText="Search feature areas" placeholder="Search feature areas" value={query} onChange={(e) => setQuery(e.target.value)} />
        {areas.isSuccess && live.length === 0 && <p className={styles.empty}>There are no feature areas yet. Add one on the Feature areas page under Settings.</p>}
        {live.length > 0 && shown.length === 0 && <p className={styles.empty}>No feature area matches “{query.trim()}”.</p>}
        <ul className={styles.list} aria-label="Feature areas">
          {shown.map((a) => (
            <li key={a.id}>
              <Button kind="ghost" size="md" className={styles.choice} data-testid={`choose-area-${a.name}`} onClick={() => { setQuery(''); onChoose(a.id) }}>
                <span className={styles.name}>{a.name}</span>
                {a.definition && <span className={styles.definition}>{a.definition}</span>}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  )
}
