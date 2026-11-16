import { useState } from 'react'
import { Button, InlineNotification, Loading, Modal, Tag } from '@carbon/react'
import { friendlyMessage, type TrashItem } from '../../api/client'
import { useDeleteFromTrash, useMe, useRestoreFromTrash, useTrash } from '../../api/hooks'
import { PageHero } from '../../shell/PageHero'
import styles from './TrashPage.module.scss'
import { plural, summaryText } from './trashText'

const KIND: Record<TrashItem['kind'], string> = { project: 'Project', document: 'Document', journey: 'Journey' }
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
// My deleted items: what was deleted in the last 90 days, to put back or remove for good. Owners see everything in the workspace; an editor sees what they deleted.
export function TrashPage() {
  const me = useMe()
  const trash = useTrash()
  const restore = useRestoreFromTrash()
  const purge = useDeleteFromTrash()
  const [removing, setRemoving] = useState<TrashItem | null>(null)
  const [back, setBack] = useState<{ name: string; leftOut: number } | null>(null)
  const owner = me.data?.role === 'owner'
  const items = trash.data?.data ?? []
  const days = trash.data?.retentionDays ?? 90
  return (
    <div className={styles.page}>
      <PageHero
        title="My deleted items"
        description={owner ? `Everything deleted in this workspace in the last ${days} days. Put it back, or remove it for good.` : `What you deleted in the last ${days} days. Put it back any time before then.`}
        glow="left"
      />
      {trash.isPending && <Loading small withOverlay={false} description="Loading deleted items" />}
      {trash.isError && <p className={styles.muted}>{friendlyMessage(trash.error)}</p>}
      {trash.isSuccess && items.length === 0 && (
        <p className={styles.muted} data-testid="trash-empty">
          Nothing deleted. Anything you delete is held here for {days} days, so you can put it back.
        </p>
      )}
      {back && (
        <InlineNotification
          lowContrast
          kind="success"
          title={`${back.name} is back`}
          subtitle={back.leftOut > 0 ? `${plural(back.leftOut, 'link')} to things that were removed in the meantime could not return.` : undefined}
          data-testid="trash-restored"
          onCloseButtonClick={() => setBack(null)}
        />
      )}
      {restore.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Not restored" subtitle={friendlyMessage(restore.error)} />}
      {items.length > 0 && (
        <ul className={styles.list} aria-label="Deleted items">
          {items.map((t) => (
            <li key={t.id} className={styles.row} data-testid="trash-row">
              <div className={styles.what}>
                <span className={styles.name}>{t.name}</span>
                <span className={styles.meta}>
                  {summaryText(t.summary) ? `${summaryText(t.summary)} · ` : ''}deleted {day(t.deletedAt)}
                  {t.deletedBy?.name ? ` by ${t.deletedBy.name}` : ''} · {plural(t.daysLeft, 'day')} left
                </span>
              </div>
              <Tag size="sm" type="gray">
                {KIND[t.kind]}
              </Tag>
              <div className={styles.actions}>
                <Button
                  kind="tertiary"
                  size="sm"
                  data-testid="trash-restore"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(t.id, { onSuccess: (r) => setBack({ name: r.name, leftOut: r.leftOut }) })}
                >
                  Restore
                </Button>
                {owner && (
                  <Button kind="danger--ghost" size="sm" data-testid="trash-delete-now" onClick={() => setRemoving(t)}>
                    Delete now
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={removing !== null}
        danger
        size="sm"
        modalHeading="Delete now?"
        primaryButtonText={purge.isPending ? 'Deleting…' : 'Delete now'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={purge.isPending}
        onRequestClose={() => setRemoving(null)}
        onRequestSubmit={() => removing && purge.mutate(removing.id, { onSuccess: () => setRemoving(null) })}
      >
        <p className={styles.confirm}>
          This removes <strong>{removing?.name}</strong> and everything under it for good. It cannot be restored.
        </p>
        {purge.isError && <InlineNotification kind="error" lowContrast hideCloseButton title="Not deleted" subtitle={friendlyMessage(purge.error)} />}
      </Modal>
    </div>
  )
}
