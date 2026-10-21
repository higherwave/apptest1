import { Add } from '@carbon/icons-react'
import { Button, ClickableTile, InlineNotification, Loading, Modal, OverflowMenu, OverflowMenuItem, Tag, TextArea, TextInput } from '@carbon/react'
import { useState } from 'react'
import type { ProjectDetail, SpecSummary } from '../../api/client'
import { ProjectHeader } from '../project/ProjectHeader'
import styles from './RequirementsList.module.scss'

export type RequirementsListProps = {
  state: 'loading' | 'error' | 'ready'
  project?: ProjectDetail
  specs: SpecSummary[]
  standalone: SpecSummary[]
  canEdit: boolean
  busy: boolean
  errorText?: string
  removing: SpecSummary | null
  removeError?: string
  onOpen: (spec: SpecSummary) => void
  onNew: () => void
  onNewStandalone: (name: string, what: string) => void
  onRemove: (spec: SpecSummary) => void
  onConfirmRemove: () => void
  onCancelRemove: () => void
  onBack: () => void
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

// Presentational: this project's requirements documents, a way to start one, and stand-alone documents.
export function RequirementsList({ state, project, specs, standalone, canEdit, busy, errorText, removing, removeError, onOpen, onNew, onNewStandalone, onRemove, onConfirmRemove, onCancelRemove, onBack }: RequirementsListProps) {
  const [dialog, setDialog] = useState(false)
  const [name, setName] = useState('')
  const [what, setWhat] = useState('')
  const close = () => {
    setDialog(false)
    setName('')
    setWhat('')
  }

  return (
    <div className={styles.page}>
      {project && <ProjectHeader name={project.name} status={project.status} title="Requirements" description="Turn the themes into a reviewed product brief and requirements, then publish them to the board." onBack={onBack} />}
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

          <section className={styles.section}>
            <div className={styles.head}>
              <h2 className={styles.heading}>Stand-alone documents</h2>
              <Button kind="secondary" size="md" disabled={!canEdit || busy} onClick={() => setDialog(true)}>
                Write a stand-alone document
              </Button>
            </div>
            <p className={styles.hint}>A document with no research behind it, drafted from your description alone.</p>
            <div className={styles.grid}>
              {standalone.map((s) => (
                <SpecCard key={s.id} spec={s} canEdit={canEdit} onOpen={onOpen} onRemove={onRemove} />
              ))}
            </div>
          </section>
        </>
      )}

      <Modal
        open={dialog}
        size="sm"
        modalHeading="Stand-alone document"
        primaryButtonText={busy ? 'Starting…' : 'Start'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={!name.trim() || !what.trim() || busy}
        onRequestClose={close}
        onRequestSubmit={() => {
          onNewStandalone(name.trim(), what.trim())
          close()
        }}
      >
        <TextInput id="standalone-name" labelText="Document name" value={name} onChange={(e) => setName(e.target.value)} />
        <TextArea id="standalone-what" labelText="What are you specifying?" rows={3} placeholder="The feature or change, and who it is for" value={what} onChange={(e) => setWhat(e.target.value)} />
      </Modal>

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
