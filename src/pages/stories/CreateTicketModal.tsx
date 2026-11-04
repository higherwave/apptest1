import { Dropdown, InlineNotification, Modal, TextArea, TextInput } from '@carbon/react'
import { useState } from 'react'
import type { CreateTicketInput, StoryDetail } from '../../api/client'
import { ISSUE_TYPES, labelFrom, PRIORITIES, priorityLabel, SIM_ASSIGNEES, SIM_PROJECTS, ticketBody } from './jira'
import styles from './CreateTicketModal.module.scss'

type Props = { story: StoryDetail; link: string; open: boolean; pending: boolean; errorText?: string; onClose: () => void; onCreate: (input: CreateTicketInput) => void }

// The Create ticket dialog: the one place anything is edited. It opens pre-filled from the story (summary, description, priority, a label
// from the theme), and what is sent is kept as the record. The connection is simulated, and the dialog says so.
export function CreateTicketModal(props: Props) {
  // Keyed by the story, so a different story opens with its own values.
  return <Form key={props.story.id} {...props} />
}

function Form({ story, link, open, pending, errorText, onClose, onCreate }: Props) {
  const [project, setProject] = useState(SIM_PROJECTS[0])
  const [issueType, setIssueType] = useState(ISSUE_TYPES[0])
  const [summary, setSummary] = useState(story.title)
  const [description, setDescription] = useState(() => ticketBody(story, link))
  const [priority, setPriority] = useState(priorityLabel(story.priority))
  const [assignee, setAssignee] = useState(SIM_ASSIGNEES[0])
  const [labels, setLabels] = useState(() => labelFrom(story.theme?.title))
  const [points, setPoints] = useState('')
  const valid = summary.trim().length > 0 && /^\d{0,3}(\.\d)?$/.test(points.trim())
  return (
    <Modal
      open={open}
      size="md"
      modalHeading="Create Jira ticket"
      modalLabel={`${story.key} · ${story.title}`}
      primaryButtonText={pending ? 'Creating…' : 'Create ticket'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={!valid || pending}
      onRequestClose={onClose}
      onRequestSubmit={() => valid && !pending && onCreate({ project, issueType: issueType as CreateTicketInput['issueType'], summary: summary.trim(), description, priority: priority as CreateTicketInput['priority'], assignee, labels: labels.trim(), points: points.trim() || null })}
    >
      <div className={styles.form}>
        <InlineNotification kind="info" lowContrast hideCloseButton title="Simulated Jira connection" subtitle="The ticket is created and recorded here. Nothing is sent to Jira yet." />
        <div className={styles.pair}>
          <Dropdown id="ticket-project" titleText="Project" label="Project" items={SIM_PROJECTS} selectedItem={project} onChange={({ selectedItem }) => selectedItem && setProject(selectedItem)} />
          <Dropdown id="ticket-type" titleText="Issue type" label="Issue type" items={ISSUE_TYPES} selectedItem={issueType} onChange={({ selectedItem }) => selectedItem && setIssueType(selectedItem)} />
        </div>
        <TextInput id="ticket-summary" labelText="Summary" value={summary} invalid={summary.trim() === ''} invalidText="A summary is required." onChange={(e) => setSummary(e.target.value)} />
        <TextArea id="ticket-description" labelText="Description" rows={9} value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className={styles.pair}>
          <Dropdown id="ticket-priority" titleText="Priority" label="Priority" items={PRIORITIES} selectedItem={priority} onChange={({ selectedItem }) => selectedItem && setPriority(selectedItem)} />
          <Dropdown id="ticket-assignee" titleText="Assignee" label="Assignee" items={SIM_ASSIGNEES} selectedItem={assignee} onChange={({ selectedItem }) => selectedItem && setAssignee(selectedItem)} />
        </div>
        <div className={styles.pair}>
          <TextInput id="ticket-labels" labelText="Labels" value={labels} onChange={(e) => setLabels(e.target.value)} />
          <TextInput id="ticket-points" labelText="Story points" placeholder="For example 5" value={points} invalid={!/^\d{0,3}(\.\d)?$/.test(points.trim())} invalidText="Use a number." onChange={(e) => setPoints(e.target.value)} />
        </div>
        {errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Not created" subtitle={errorText} />}
      </div>
    </Modal>
  )
}
