import { Dropdown, InlineNotification, Modal, TextArea, TextInput } from '@carbon/react'
import { useState } from 'react'
import type { CreateTicketInput, JiraStatus, StoryDetail } from '../../api/client'
import { ISSUE_TYPES, labelFrom, PRIORITIES, priorityLabel, SIM_ASSIGNEES, SIM_PROJECTS, ticketBody } from './jira'
import styles from './CreateTicketModal.module.scss'

type Props = { story: StoryDetail; link: string; open: boolean; pending: boolean; errorText?: string; jira?: JiraStatus; onClose: () => void; onCreate: (input: CreateTicketInput) => void }

const UNASSIGNED = { id: '', name: 'Unassigned' }

// The Create ticket dialog: the one place anything is edited. It opens pre-filled from the story (summary, description, priority, a label
// from the theme), and what is sent is kept as the record. Only fields Jira has are here: with Jira connected the project is its one project
// and the issue types, priorities and people come from it; without it the dialog says the connection is simulated.
export function CreateTicketModal(props: Props) {
  // Keyed by the story, so a different story opens with its own values; and by whether Jira has answered, so the options it gives are the starting ones.
  return <Form key={`${props.story.id}:${props.jira?.connected ? (props.jira.problem ? 'problem' : 'jira') : 'sim'}`} {...props} />
}

function Form({ story, link, open, pending, errorText, jira, onClose, onCreate }: Props) {
  const live = !!jira?.connected && !jira.problem
  const types = live && jira.issueTypes.length ? jira.issueTypes : ISSUE_TYPES
  const priorities = live && jira.priorities.length ? jira.priorities : PRIORITIES
  const people = live ? [UNASSIGNED, ...jira.assignees] : SIM_ASSIGNEES.map((name) => ({ id: '', name }))
  const wantedPriority = priorityLabel(story.priority)
  const [project, setProject] = useState(SIM_PROJECTS[0])
  const [issueType, setIssueType] = useState(types[0])
  const [summary, setSummary] = useState(story.title)
  const [description, setDescription] = useState(() => ticketBody(story, link))
  const [priority, setPriority] = useState(priorities.includes(wantedPriority) ? wantedPriority : priorities[Math.floor(priorities.length / 2)])
  const [assignee, setAssignee] = useState(people[0])
  const [labels, setLabels] = useState(() => labelFrom(story.theme?.title))
  const valid = summary.trim().length > 0 && !!issueType && !!priority
  const submit = () =>
    valid && !pending && onCreate({ ...(live ? {} : { project }), issueType, summary: summary.trim(), description, priority, assignee: assignee.name, assigneeId: assignee.id || null, labels: labels.trim() })
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
      onRequestSubmit={submit}
    >
      <div className={styles.form}>
        {live ? (
          <InlineNotification kind="info" lowContrast hideCloseButton title="Connected to Jira" subtitle={`This creates a real issue in ${jira.projectKey} · ${jira.projectName ?? 'your Jira project'}.`} />
        ) : jira?.problem ? (
          <InlineNotification kind="warning" lowContrast hideCloseButton title="Jira could not be read" subtitle={`${jira.problem} Creating a ticket may fail until that is fixed.`} />
        ) : (
          <InlineNotification kind="info" lowContrast hideCloseButton title="Simulated Jira connection" subtitle="The ticket is created and recorded here. Nothing is sent to Jira." />
        )}
        <div className={styles.pair}>
          {live ? (
            <TextInput id="ticket-project" labelText="Project" readOnly value={`${jira.projectKey} · ${jira.projectName ?? ''}`} />
          ) : (
            <Dropdown id="ticket-project" titleText="Project" label="Project" items={SIM_PROJECTS} selectedItem={project} onChange={({ selectedItem }) => selectedItem && setProject(selectedItem)} />
          )}
          <Dropdown id="ticket-type" titleText="Issue type" label="Issue type" items={types} selectedItem={issueType} onChange={({ selectedItem }) => selectedItem && setIssueType(selectedItem)} />
        </div>
        <TextInput id="ticket-summary" labelText="Summary" value={summary} invalid={summary.trim() === ''} invalidText="A summary is required." onChange={(e) => setSummary(e.target.value)} />
        <TextArea id="ticket-description" labelText="Description" rows={9} value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className={styles.pair}>
          <Dropdown id="ticket-priority" titleText="Priority" label="Priority" items={priorities} selectedItem={priority} onChange={({ selectedItem }) => selectedItem && setPriority(selectedItem)} />
          <Dropdown id="ticket-assignee" titleText="Assignee" label="Assignee" items={people} itemToString={(p) => p?.name ?? ''} selectedItem={assignee} onChange={({ selectedItem }) => selectedItem && setAssignee(selectedItem)} />
        </div>
        <TextInput id="ticket-labels" labelText="Labels" helperText={live ? 'Separate labels with spaces or commas.' : undefined} value={labels} onChange={(e) => setLabels(e.target.value)} />
        {errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Not created" subtitle={errorText} />}
      </div>
    </Modal>
  )
}
