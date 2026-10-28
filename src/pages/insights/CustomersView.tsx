import { ChevronDown, ChevronUp } from '@carbon/icons-react'
import { Button, InlineNotification, Loading, Tag } from '@carbon/react'
import { useState } from 'react'
import type { Customers } from '../../api/client'
import { CategoryBadge } from '../themes/CategoryBadge'
import { InsightsHeader } from './InsightsHeader'
import { STATUS } from './labels'
import styles from './CustomersView.module.scss'

export type CustomersViewProps = {
  state: 'loading' | 'error' | 'empty' | 'ready'
  customers?: Customers
  errorText?: string
  onOpenTheme: (id: string) => void
  onOpenTranscripts: (projectId: string) => void
}

type Group = Customers['groups'][number]
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

function Body({ group, onOpenTheme, onOpenTranscripts }: { group: Group; onOpenTheme: CustomersViewProps['onOpenTheme']; onOpenTranscripts: CustomersViewProps['onOpenTranscripts'] }) {
  return (
    <div id={`customer-body-${group.key}`} className={styles.body}>
      <p className={styles.roles}>
        {group.roles.join(' · ')} — in {group.projects.map((p) => p.name).join(', ')}
      </p>
      <div className={styles.split}>
        <div className={styles.cell}>
          <h4 className={styles.colHead}>What they struggle with</h4>
          <p className={styles.muted}>Most-raised first, and what became of each</p>
          {group.themes.map((t) => (
            <div key={t.id} className={styles.theme}>
              <Button kind="ghost" size="sm" className={styles.themeLink} onClick={() => onOpenTheme(t.id)}>
                {t.title}
              </Button>
              <div className={styles.tags}>
                <CategoryBadge category={t.category} />
                {t.opportunity && <Tag size="sm" type="purple">Opportunity</Tag>}
                <Tag size="sm" type={STATUS[t.status].tag}>{STATUS[t.status].label}</Tag>
                <span className={styles.count}>{t.participantCount} of {group.participantCount}</span>
              </div>
            </div>
          ))}
        </div>
        <div className={styles.cell}>
          <h4 className={styles.colHead}>In their words</h4>
          <p className={styles.muted}>Taken from the transcripts, about problems first</p>
          {group.quotes.map((q) => (
            <blockquote key={q.id} className={styles.quote}>
              <p className={styles.quoteText}>“{q.text}”</p>
              <p className={styles.quoteMeta}>
                {q.speaker} · {q.session} · on “{q.themeTitle}”
                <Button kind="ghost" size="sm" className={styles.open} onClick={() => onOpenTranscripts(q.projectId)}>
                  Open transcript
                </Button>
              </p>
            </blockquote>
          ))}
        </div>
      </div>
    </div>
  )
}

// Presentational: who the customers are, grouped by role, each with what they struggle with and what they said.
export function CustomersView({ state, customers, errorText, onOpenTheme, onOpenTranscripts }: CustomersViewProps) {
  const [opened, setOpened] = useState<Set<string>>(new Set())
  const groups = customers?.groups ?? []
  const toggle = (key: string) => setOpened((o) => { const n = new Set(o); if (n.has(key)) n.delete(key); else n.add(key); return n })
  // The largest group opens first, so the page does not start as a closed list.
  const first = groups[0]?.key
  const [started, setStarted] = useState(false)
  if (!started && first) {
    setStarted(true)
    setOpened(new Set([first]))
  }
  return (
    <div className={styles.page}>
      <InsightsHeader title="Platform Insights" description="Who our customers are, in the words of the people we have talked to" />
      {errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Something went wrong" subtitle={errorText} />}
      {state === 'loading' && <Loading withOverlay={false} description="Loading personas" />}
      {state === 'empty' && <p className={styles.muted}>No personas yet. Analyze a project’s transcripts and the people in it appear here, grouped by their role.</p>}
      {state === 'ready' && customers && (
        <>
          <div className={styles.listTools}>
            <p className={styles.muted}>
              {plural(groups.length, 'group')} · {plural(customers.totalParticipants, 'participant')}
            </p>
            <Button kind="ghost" size="sm" onClick={() => setOpened(opened.size === groups.length ? new Set() : new Set(groups.map((g) => g.key)))}>
              {opened.size === groups.length ? 'Collapse all' : 'Expand all'}
            </Button>
          </div>
          <ul className={styles.list} aria-label="Personas">
            {groups.map((g) => {
              const open = opened.has(g.key)
              return (
                <li key={g.key} className={styles.item} data-testid={`customer-${g.key}`} data-open={open}>
                  <h3 className={styles.itemHead}>
                    <Button kind="ghost" size="md" className={styles.headButton} renderIcon={open ? ChevronUp : ChevronDown} aria-expanded={open} aria-controls={`customer-body-${g.key}`} onClick={() => toggle(g.key)}>
                      <span className={styles.headText}>
                        <span className={styles.name}>{g.name}</span>
                        <span className={styles.status}>
                          {g.opportunities > 0 && <Tag size="sm" type="purple">{plural(g.opportunities, 'opportunity', 'opportunities')}</Tag>}
                          <span className={styles.meta}>
                            {plural(g.participantCount, 'participant')} · {plural(g.projectCount, 'project')}
                          </span>
                        </span>
                      </span>
                    </Button>
                  </h3>
                  {open && <Body group={g} onOpenTheme={onOpenTheme} onOpenTranscripts={onOpenTranscripts} />}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
