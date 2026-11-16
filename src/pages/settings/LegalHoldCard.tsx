import { useState } from 'react'
import { Button, Dropdown, InlineNotification, Modal, Tag, TextArea } from '@carbon/react'
import { friendlyMessage, type LegalHold } from '../../api/client'
import { useHolds, usePlaceHold, useProjects, useReleaseHold } from '../../api/hooks'
import styles from './DataPage.module.scss'

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
const WORKSPACE = { id: '', label: 'The whole workspace' }

// A legal hold keeps what it covers: nothing under it is deleted for good or aged out until an owner releases it. It has no end date.
export function LegalHoldCard() {
  const holds = useHolds()
  const projects = useProjects()
  const place = usePlaceHold()
  const release = useReleaseHold()
  const [scope, setScope] = useState(WORKSPACE)
  const [reason, setReason] = useState('')
  const [releasing, setReleasing] = useState<LegalHold | null>(null)
  const all = holds.data?.data ?? []
  const active = all.filter((h) => !h.releasedAt)
  const history = all.filter((h) => h.releasedAt)
  const scopes = [WORKSPACE, ...(projects.data ?? []).map((p) => ({ id: p.id, label: p.name }))]
  const ready = reason.trim().length >= 3

  return (
    <section className={styles.card} aria-label="Legal hold" data-testid="legal-hold">
      <h2 className={styles.head}>Legal hold</h2>
      <p className={styles.text}>
        A hold keeps what it covers. While it is in force, nothing under it is deleted for good (by you or by the clean-up that removes old records), and it has no end date: it lasts until an owner releases it.
        A hold on a project covers that project; any hold also pauses the removal of old audit log and AI usage records. Placing and releasing a hold are recorded in the audit log.
      </p>
      {active.length > 0 && (
        <ul className={styles.rows} aria-label="Holds in force">
          {active.map((h) => (
            <li key={h.id} className={styles.row} data-testid="hold-row">
              <div className={styles.what}>
                <p className={styles.title}>
                  {h.scope === 'workspace' ? 'The whole workspace' : h.scopeName} <Tag size="sm" type="red">In force</Tag>
                </p>
                <p className={styles.note}>
                  {h.reason} · placed {day(h.setAt)}
                  {h.setBy?.name ? ` by ${h.setBy.name}` : ''}
                </p>
              </div>
              <Button kind="tertiary" size="md" data-testid="hold-release" onClick={() => setReleasing(h)}>
                Release
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.form}>
        <Dropdown
          id="hold-scope"
          data-testid="hold-scope"
          titleText="What to hold"
          label="Choose"
          items={scopes}
          itemToString={(i: { id: string; label: string } | null) => i?.label ?? ''}
          selectedItem={scope}
          onChange={({ selectedItem }: { selectedItem?: { id: string; label: string } | null }) => selectedItem && setScope(selectedItem)}
        />
        <TextArea id="hold-reason" data-testid="hold-reason" labelText="Why" helperText="For example the matter or the request. Kept with the hold." rows={2} maxCount={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className={styles.actions}>
          <Button
            kind="primary"
            size="md"
            data-testid="hold-place"
            disabled={!ready || place.isPending}
            onClick={() => place.mutate({ projectId: scope.id || null, reason }, { onSuccess: () => { setReason(''); setScope(WORKSPACE) } })}
          >
            {place.isPending ? 'Placing…' : 'Place hold'}
          </Button>
        </div>
        {place.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="No hold placed" subtitle={friendlyMessage(place.error)} />}
      </div>
      {history.length > 0 && (
        <>
          <h3 className={styles.head}>Released</h3>
          <ul className={styles.rows} aria-label="Released holds">
            {history.map((h) => (
              <li key={h.id} className={styles.row}>
                <div className={styles.what}>
                  <p className={styles.title}>{h.scope === 'workspace' ? 'The whole workspace' : h.scopeName}</p>
                  <p className={styles.note}>
                    {h.reason} · {day(h.setAt)} to {day(h.releasedAt!)}
                    {h.releasedBy?.name ? `, released by ${h.releasedBy.name}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <Modal
        open={releasing !== null}
        size="sm"
        modalHeading="Release this hold?"
        primaryButtonText={release.isPending ? 'Releasing…' : 'Release'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={release.isPending}
        onRequestClose={() => setReleasing(null)}
        onRequestSubmit={() => releasing && release.mutate(releasing.id, { onSuccess: () => setReleasing(null) })}
      >
        <p className={styles.text}>
          {releasing?.scope === 'workspace' ? 'Everything in the workspace' : releasing?.scopeName} can then be deleted for good, and old records are removed again in the next daily clean-up.
        </p>
        {release.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Not released" subtitle={friendlyMessage(release.error)} />}
      </Modal>
    </section>
  )
}
