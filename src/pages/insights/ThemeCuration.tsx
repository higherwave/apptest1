import { Button, Dropdown, InlineNotification, Modal, Tag, TextInput } from '@carbon/react'
import { useState } from 'react'
import type { InsightsThemes } from '../../api/client'
import styles from './ThemeCuration.module.scss'

type Row = InsightsThemes['themes'][number]
type Suggestion = InsightsThemes['mergeSuggestions'][number]

/** What the page can do to keep platform themes tidy; passed down as one object so the view stays presentational. */
export type Curation = {
  canEdit: boolean
  busy: boolean
  error?: string
  onRename: (id: string, title: string) => void
  onMerge: (id: string, intoId: string) => void
  onFindDuplicates: () => void
  onAccept: (id: string) => void
  onDismiss: (id: string) => void
  onRationale: () => void
}

const pct = (n: number | null) => (n === null ? '' : ` · ${Math.round(n * 100)}%`)

// Rename and merge for one open theme. The parent keys it by the theme's id and title, so it starts from the saved name.
export function ThemeTools({ theme, others, curation }: { theme: Row; others: Row[]; curation: Curation }) {
  const [title, setTitle] = useState(theme.title)
  const [target, setTarget] = useState<Row | null>(null)
  const [confirm, setConfirm] = useState(false)
  const changed = title.trim() !== theme.title && title.trim().length >= 3
  return (
    <section aria-label="Tidy this theme" className={styles.tools} data-testid={`tools-${theme.id}`}>
      <h3 className={styles.label}>Tidy this theme</h3>
      <div className={styles.row}>
        <TextInput id={`rename-${theme.id}`} labelText="Theme name" size="md" maxLength={90} value={title} onChange={(e) => setTitle(e.target.value)} />
        <Button kind="tertiary" size="md" disabled={!changed || curation.busy} onClick={() => curation.onRename(theme.id, title.trim())}>
          Rename
        </Button>
      </div>
      <p className={styles.hint}>The old name is kept, so the matcher still recognises it.</p>
      {others.length > 0 && (
        <div className={styles.row}>
          <Dropdown
            id={`merge-${theme.id}`}
            titleText="Merge into"
            label="Choose a theme"
            size="md"
            items={others}
            itemToString={(t: Row | null) => t?.title ?? ''}
            selectedItem={target}
            onChange={({ selectedItem }: { selectedItem: Row | null }) => setTarget(selectedItem ?? null)}
          />
          <Button kind="danger--tertiary" size="md" disabled={!target || curation.busy} onClick={() => setConfirm(true)}>
            Merge…
          </Button>
        </div>
      )}
      <Modal
        open={confirm && !!target}
        danger
        size="sm"
        modalHeading="Merge these themes?"
        primaryButtonText="Merge"
        secondaryButtonText="Cancel"
        onRequestClose={() => setConfirm(false)}
        onRequestSubmit={() => {
          if (target) curation.onMerge(theme.id, target.id)
          setConfirm(false)
          setTarget(null)
        }}
      >
        <p>
          <strong>{theme.title}</strong> will be folded into <strong>{target?.title}</strong>. The project themes filed under it, and its recommendations and case studies, move across, and its name becomes an old name of the other. This cannot be undone.
        </p>
      </Modal>
    </section>
  )
}

// The pairs that look like duplicates, waiting for a person: merge them or say they are different.
export function DuplicatesPanel({ suggestions, curation }: { suggestions: Suggestion[]; curation: Curation }) {
  if (!suggestions.length && !curation.canEdit) return null
  return (
    <section className={styles.panel} aria-label="Possible duplicates" data-testid="duplicates-panel">
      <div className={styles.panelHead}>
        <h2 className={styles.label}>Possible duplicates · {suggestions.length}</h2>
        {curation.canEdit && (
          <Button kind="ghost" size="sm" disabled={curation.busy} onClick={curation.onFindDuplicates}>
            Check for duplicates
          </Button>
        )}
      </div>
      {suggestions.length === 0 ? (
        <p className={styles.hint}>None waiting. New themes are checked automatically after an analysis.</p>
      ) : (
        <ul className={styles.list}>
          {suggestions.map((s) => (
            <li key={s.id} className={styles.suggestion} data-testid={`suggestion-${s.id}`}>
              <div className={styles.pair}>
                <span>
                  <strong>{s.merge.title}</strong> <span className={styles.muted}>({s.merge.participantCount})</span>
                </span>
                <span className={styles.arrow} aria-label="would merge into">
                  →
                </span>
                <span>
                  <strong>{s.keep.title}</strong> <span className={styles.muted}>({s.keep.participantCount})</span>
                </span>
              </div>
              {s.reason && (
                <p className={styles.hint}>
                  {s.reason}
                  {pct(s.confidence)}
                </p>
              )}
              {curation.canEdit && (
                <div className={styles.actions}>
                  <Button kind="tertiary" size="sm" disabled={curation.busy} onClick={() => curation.onAccept(s.id)}>
                    Merge
                  </Button>
                  <Button kind="ghost" size="sm" disabled={curation.busy} onClick={() => curation.onDismiss(s.id)}>
                    Not the same
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {curation.error && <InlineNotification kind="error" lowContrast hideCloseButton title="That did not work" subtitle={curation.error} />}
    </section>
  )
}

// The suggested rank, its figures, and the written reason; editors can have the reasons written.
export function PriorityNote({ theme, curation }: { theme: Row; curation: Curation }) {
  if (!theme.priority) return null
  return (
    <section aria-label="Suggested priority" data-testid={`priority-${theme.id}`}>
      <h3 className={styles.label}>Suggested priority</h3>
      <p className={styles.text}>
        <Tag size="sm" type="purple">
          #{theme.priority.rank}
        </Tag>{' '}
        Score {theme.priority.score}. {theme.rationale ?? 'No rationale written yet.'}
      </p>
      {!theme.rationale && curation.canEdit && theme.priority.rank <= 8 && (
        <Button kind="ghost" size="sm" disabled={curation.busy} onClick={curation.onRationale}>
          Write rationale for the top 8
        </Button>
      )}
    </section>
  )
}

// How each project theme came to be filed here, with the model's reason when it made the match.
export function MatchList({ theme }: { theme: Row }) {
  if (!theme.matches.length) return null
  return (
    <section aria-label="How themes were matched">
      <h3 className={styles.label}>How themes were matched</h3>
      <ul className={styles.matches}>
        {theme.matches.map((m, i) => (
          <li key={i} className={styles.text}>
            <strong>{m.themeTitle}</strong>
            <br />
            <span className={styles.muted}>{m.method === 'manual' ? 'Set by hand' : `AI match${pct(m.confidence)}`}{m.reason ? `: ${m.reason}` : ''}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
