import { Add } from '@carbon/icons-react'
import { Button, ClickableTile, InlineNotification, Loading, Modal, OverflowMenu, OverflowMenuItem, Tag } from '@carbon/react'
import type { ProjectDetail, SpecSummary } from '../../api/client'
import { ProjectHeader } from '../project/ProjectHeader'
import styles from './RequirementsList.module.scss'

export type RequirementsListProps = {
  state: 'loading' | 'error' | 'ready'
  project?: ProjectDetail
  specs: SpecSummary[]
  canEdit: boolean
  busy: boolean
  errorText?: string
  removing: SpecSummary | null
  removeError?: string
  onOpen: (spec: SpecSummary) => void
  onNew: () => void
  onRemove: (spec: SpecSummary) => void
  onConfirmRemove: () => void
  onCancelRemove: () => void
}

function SpecCard({ spec, canEdit, onOpen, onRemove }: { spec: SpecSummary; canEdit: boolean; onOpen: (s: SpecSummary) => void; onRemove: (s: SpecSummary) => void }) {
  return (
    <div className={styles.wrap}>
      <ClickableTile className={styles.card} onClick={() => onOpen(spec)}>
        <div className={styles.top}>
          <p className={styles.name}>{spec.name}</p>
          <Tag className={styles.status} size="sm" type={spec.status === 'published' ? 'green' : 'gray'}>
            {spec.status === 'published' ? 'Published' : 'Draft'}
          </Tag>
        </div>
        <p className={styles.meta}>
          {spec.approved} of {spec.total} steps approved
        </p>
        {spec.stale && <p className={styles.stale}>Themes changed after this was drafted</p>}
      </ClickableTile>
      {canEdit && (
        <div className={styles.menu}>
          <OverflowMenu iconDescription={`Actions for ${spec.name}`} flipped size="sm">
            <OverflowMenuItem itemText="Delete document" isDelete onClick={() => onRemove(spec)} />
          </OverflowMenu>
        </div>
      )}
    </div>
  )
}

// Presentational: this project's requirements documents, and a way to start another from its themes.
export function RequirementsList({ state, project, specs, canEdit, busy, errorText, removing, removeError, onOpen, onNew, onRemove, onConfirmRemove, onCancelRemove }: RequirementsListProps) {
  return (
    <div className={styles.page}>
      {project && <ProjectHeader title="Requirements" description="Turn the themes into a reviewed product brief and requirements, then publish them to the board." />}
      {state === 'loading' && <Loading small withOverlay={false} description="Loading documents" />}
      {state === 'error' && <InlineNotification kind="warning" lowContrast hideCloseButton title="Requirements" subtitle={errorText} />}
      {errorText && state === 'ready' && <InlineNotification kind="warning" lowContrast hideCloseButton title="Not started" subtitle={errorText} />}

      {state === 'ready' && (
        <>
          <section className={styles.section}>
            <div className={styles.head}>
              <h2 className={styles.heading}>Documents from this project</h2>
              <Button className={styles.wide} kind="primary" size="md" renderIcon={Add} disabled={!canEdit || busy} onClick={onNew}>
                New document from these themes
              </Button>
            </div>
            {specs.length === 0 && <p className={styles.empty}>No documents yet. Start one to draft a product brief from the themes.</p>}
            <div className={styles.grid}>
              {specs.map((s) => (
                <SpecCard key={s.id} spec={s} canEdit={canEdit} onOpen={onOpen} onRemove={onRemove} />
              ))}
            </div>
          </section>
        </>
      )}

      <Modal
        open={removing !== null}
        danger
        size="sm"
        modalHeading="Delete this document?"
        primaryButtonText="Delete permanently"
        secondaryButtonText="Cancel"
        onRequestClose={onCancelRemove}
        onRequestSubmit={onConfirmRemove}
      >
        <p className={styles.confirm}>
          This permanently deletes <strong>{removing?.name}</strong>
          {removing?.status === 'published' ? ', and the requirements and stories it created on the board' : ''}. It cannot be undone.
        </p>
        {removeError && <InlineNotification kind="error" lowContrast hideCloseButton title="Not deleted" subtitle={removeError} />}
      </Modal>
    </div>
  )
}
