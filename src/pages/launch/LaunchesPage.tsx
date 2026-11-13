import { Loading, Tag } from '@carbon/react'
import { useNavigate } from 'react-router-dom'
import { friendlyMessage } from '../../api/client'
import { useLaunches } from '../../api/hooks'
import { PageHero } from '../../shell/PageHero'
import { dayText, stateLabel, stateTag } from './launchText'
import styles from './LaunchesPage.module.scss'
import { STEP_LABELS } from './stepLabels'

// The launches the signed-in person may see, with what is waiting on them. How a reviewer finds a launch of a team they are not in.
export function LaunchesPage({ title = 'My reviews', description = 'The launches you can see, and where your answer is waiting.' }: { title?: string; description?: string }) {
  const navigate = useNavigate()
  const list = useLaunches()
  const items = list.data?.data ?? []
  return (
    <div className={styles.page}>
      <PageHero title={title} description={description} glow="left" />
      {list.isPending && <Loading small withOverlay={false} description="Loading launches" />}
      {list.isError && <p className={styles.muted}>{friendlyMessage(list.error)}</p>}
      {list.isSuccess && items.length === 0 && <p className={styles.muted} data-testid="no-launches">No launches yet. When you are asked to review one, it appears here.</p>}
      {items.length > 0 && (
        <ul className={styles.list} aria-label="Launches">
          {items.map((l) => (
            <li key={l.id} className={styles.row} data-testid={`launch-${l.id}`}>
              <a
                href={`/launches/${l.id}`}
                className={styles.link}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                  e.preventDefault()
                  navigate(`/launches/${l.id}`)
                }}
              >
                <span className={styles.name}>{l.name}</span>
                <span className={styles.meta}>
                  {l.projectName}{l.teamName ? ` · ${l.teamName}` : ''}{l.targetDate ? ` · target ${dayText(l.targetDate)}` : ''}
                </span>
                {l.waitingOnYou.length > 0 && <span className={styles.waiting}>Waiting on you: {l.waitingOnYou.map((s) => STEP_LABELS[s] ?? s).join(', ')}</span>}
              </a>
              <Tag size="sm" type={stateTag(l.state)}>{stateLabel(l.state)}</Tag>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
