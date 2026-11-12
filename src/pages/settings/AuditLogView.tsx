import { Button, Dropdown, InlineNotification, Loading } from '@carbon/react'
import type { AuditEntry, AuditGroup } from '../../api/client'
import { SettingsHeader } from './SettingsHeader'
import { describe, GROUP_LABEL } from './auditText'
import styles from './AuditLogView.module.scss'

const FILTERS: { key: AuditGroup | 'all'; label: string }[] = [{ key: 'all', label: 'All changes' }, ...(Object.keys(GROUP_LABEL) as AuditGroup[]).map((key) => ({ key, label: GROUP_LABEL[key] }))]

export type AuditLogViewProps = {
  state: 'loading' | 'error' | 'ready'
  entries: AuditEntry[]
  group: AuditGroup | 'all'
  /** The workspace's teams, to narrow the log to one (shown when there is more than one). */
  teams: { id: string; name: string }[]
  team: string
  onTeam: (id: string) => void
  errorText?: string
  hasMore: boolean
  loadingMore: boolean
  onGroup: (g: AuditGroup | 'all') => void
  onMore: () => void
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

// Presentational: what changed in the workspace and who changed it, newest first, one kind of change at a time. Owners only.
export function AuditLogView(p: AuditLogViewProps) {
  return (
    <div className={styles.page}>
      <SettingsHeader />
      <p className={styles.intro}>What changed in this workspace, and who changed it: people and roles, experience categories, projects, journeys and Jira hand-offs.</p>

      <div>
        <div className={styles.filter}>
          {p.teams.length > 1 && (
            <Dropdown
              id="audit-team"
              titleText="Team"
              label="All teams"
              size="md"
              items={[{ id: 'all', name: 'All teams' }, ...p.teams]}
              itemToString={(t) => t?.name ?? ''}
              selectedItem={p.team === 'all' ? { id: 'all', name: 'All teams' } : (p.teams.find((t) => t.id === p.team) ?? null)}
              onChange={({ selectedItem }) => selectedItem && p.onTeam(selectedItem.id)}
            />
          )}
          <Dropdown
            id="audit-group"
            titleText="Show"
            label="All changes"
            size="md"
            items={FILTERS}
            itemToString={(f) => f?.label ?? ''}
            selectedItem={FILTERS.find((f) => f.key === p.group)}
            onChange={({ selectedItem }) => selectedItem && p.onGroup(selectedItem.key)}
          />
        </div>
      </div>

      {p.errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Something went wrong" subtitle={p.errorText} />}
      {p.state === 'loading' && <Loading small withOverlay={false} description="Loading the audit log" />}
      {p.state === 'ready' && p.entries.length === 0 && <p className={styles.intro}>Nothing has changed yet.</p>}
      {p.state === 'ready' && p.entries.length > 0 && (
        <div className={styles.tableWrap}>
          <div className={styles.table} role="table" aria-label="Audit log">
            <div className={styles.row} role="row">
              {['When', 'Who', 'Change', 'Details'].map((h) => (
                <div key={h} className={styles.head} role="columnheader">
                  {h}
                </div>
              ))}
            </div>
            {p.entries.map((e) => {
              const d = describe(e)
              return (
                <div key={e.id} className={styles.row} role="row" data-testid="audit-row">
                  <div role="cell" className={styles.muted}>
                    {when(e.createdAt)}
                  </div>
                  <div role="cell">{e.actor?.name ?? 'The system'}</div>
                  <div role="cell">
                    {d.what}
                    {e.team && p.teams.length > 1 && <span className={styles.muted}> · {e.team.name}</span>}
                  </div>
                  <div role="cell" className={styles.muted}>
                    {d.detail}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {p.hasMore && (
        <div>
          <Button kind="tertiary" size="md" disabled={p.loadingMore} onClick={p.onMore}>
            {p.loadingMore ? 'Loading…' : 'Show more'}
          </Button>
        </div>
      )}
    </div>
  )
}
