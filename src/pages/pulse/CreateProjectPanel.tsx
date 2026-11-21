import { useEffect, useRef, useState } from 'react'
import { Button, Checkbox, InlineNotification, TextArea, TextInput } from '@carbon/react'
import { useNavigate } from 'react-router-dom'
import { friendlyMessage, type PulseQuestion, type PulseTopic } from '../../api/client'
import { useCreatePulseProject, useSuggestPulseQuestions, useTemplates } from '../../api/hooks'
import { RightPanel } from '../../components/RightPanel'
import { CHANNEL_LABEL } from './channels'
import styles from './CreateProjectPanel.module.scss'

type Q = { key: number; prompt: string; topicId: string | null; topicTitle: string; evidence: PulseQuestion['evidence'] }
let nextKey = 1
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : one + 's'}`

const nameFor = (topics: PulseTopic[]) => {
  const names = topics.map((t) => t.title)
  const text = names.length <= 2 ? names.join(' + ') : `${names[0]} + ${names.length - 1} more`
  return text.slice(0, 120)
}
const descriptionFor = (topics: PulseTopic[]) => {
  const channels = new Set(topics.flatMap((t) => Object.keys(t.channels)))
  const signals = topics.reduce((a, t) => a + t.signals, 0)
  const list = topics.map((t) => t.title.toLowerCase()).join(', ')
  return `Frame the problem around ${list}. Customers raised this ${plural(signals, 'time')} across ${plural(channels.size, 'channel')}; the questions below come from what they said.`
}

// Start a Signal Flow project from the chosen topics. It fills the Test Plan: the description under "What to test", the method, and the questions under "What to ask or observe",
// each with the customer words that prompted it. Everything can be edited here, and again in the project. Participants are not added: a person chooses who to invite.
export function CreateProjectPanel({ topics, open, onClose }: { topics: PulseTopic[]; open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const templates = useTemplates()
  const suggest = useSuggestPulseQuestions()
  const create = useCreatePulseProject()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [methods, setMethods] = useState<string[]>(['User Discussions'])
  const [questions, setQuestions] = useState<Q[]>([])
  const drafted = useRef<string>('')

  const ids = topics.map((t) => t.id)
  const method = methods[0] ?? 'User Discussions'
  const draft = async () => {
    const res = await suggest.mutateAsync({ topicIds: ids, method })
    setQuestions(res.questions.map((q) => ({ key: nextKey++, prompt: q.prompt, topicId: q.topicId, topicTitle: q.topicTitle, evidence: q.evidence })))
  }

  // Each time the panel opens for a set of topics, start from their name, description and a first draft of questions.
  useEffect(() => {
    if (!open || !topics.length) { drafted.current = ''; return }
    const sig = ids.join(',')
    if (drafted.current === sig) return
    drafted.current = sig
    setName(nameFor(topics))
    setDescription(descriptionFor(topics))
    setMethods(['User Discussions'])
    create.reset()
    void suggest.mutateAsync({ topicIds: ids, method: 'User Discussions' }).then((res) => setQuestions(res.questions.map((q) => ({ key: nextKey++, prompt: q.prompt, topicId: q.topicId, topicTitle: q.topicTitle, evidence: q.evidence }))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ids.join(',')])

  const save = async () => {
    try {
      const res = await create.mutateAsync({ name, description, methods, topicIds: ids, questions: questions.filter((q) => q.prompt.trim()).map((q) => ({ prompt: q.prompt.trim(), topicId: q.topicId })) })
      onClose()
      navigate(`/projects/${res.projectId}/plan`)
    } catch {
      /* shown below */
    }
  }
  const options = templates.data?.methodOptions ?? []
  const signals = topics.reduce((a, t) => a + t.signals, 0)

  return (
    <RightPanel open={open} heading="New Signal Flow project" label="From Pulse" wide onClose={onClose} focus="#pp-name">
      <div className={styles.body} data-testid="create-project-panel">
        <p className={styles.from} data-testid="pp-from">
          From {plural(topics.length, 'topic')} and {plural(signals, 'signal')}: {topics.map((t) => t.title).join(', ')}.
        </p>
        <TextInput id="pp-name" data-testid="pp-name" labelText="Project name" value={name} maxCount={120} onChange={(e) => setName(e.target.value)} />
        <TextArea id="pp-description" data-testid="pp-description" labelText="What to test" helperText="A sentence or two on what this research is for. It becomes the Test Plan's description." rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        <fieldset className={styles.methods}>
          <legend className={styles.legend}>Method</legend>
          {options.map((m) => (
            <Checkbox key={m} id={`pp-method-${m}`} labelText={m} checked={methods.includes(m)} onChange={(_, { checked }) => setMethods(checked ? [...methods, m] : methods.filter((x) => x !== m))} />
          ))}
        </fieldset>

        <section aria-label="Questions" className={styles.questions}>
          <div className={styles.qHead}>
            <p className={styles.legend}>Questions ({questions.length})</p>
            <Button kind="ghost" size="sm" data-testid="pp-redraft" disabled={suggest.isPending} onClick={() => void draft()}>
              {suggest.isPending ? 'Drafting…' : `Redraft for ${method.toLowerCase()}`}
            </Button>
          </div>
          <p className={styles.hint}>Drafted from what customers said, about one session’s worth. Edit, remove or add your own.</p>
          {questions.map((q, i) => (
            <div key={q.key} className={styles.q} data-testid="pp-question">
              <span className={styles.num} aria-hidden>{i + 1}</span>
              <div className={styles.qBody}>
                <TextArea id={`pp-q-${q.key}`} labelText={`Question ${i + 1}`} hideLabel rows={2} value={q.prompt} onChange={(e) => setQuestions(questions.map((x) => (x.key === q.key ? { ...x, prompt: e.target.value } : x)))} />
                <p className={styles.evidence}>
                  {q.topicTitle}
                  {q.evidence ? ` · from ${CHANNEL_LABEL[q.evidence.channel]}${q.evidence.saidBy ? `, ${q.evidence.saidBy}` : ''}: “${q.evidence.quote.length > 90 ? q.evidence.quote.slice(0, 89) + '…' : q.evidence.quote}”` : ''}
                </p>
              </div>
              <Button kind="ghost" size="sm" aria-label={`Remove question ${i + 1}`} onClick={() => setQuestions(questions.filter((x) => x.key !== q.key))}>
                Remove
              </Button>
            </div>
          ))}
          <div>
            <Button kind="ghost" size="sm" data-testid="pp-add-question" onClick={() => setQuestions([...questions, { key: nextKey++, prompt: '', topicId: null, topicTitle: 'Your own', evidence: null }])}>
              Add a question
            </Button>
          </div>
        </section>

        {suggest.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Questions could not be drafted" subtitle={friendlyMessage(suggest.error)} />}
        {create.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="The project was not created" subtitle={friendlyMessage(create.error)} />}
        <div className={styles.actions}>
          <Button kind="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="primary" size="md" data-testid="pp-save" disabled={!name.trim() || !topics.length || create.isPending} onClick={save}>
            {create.isPending ? 'Creating…' : 'Create project'}
          </Button>
        </div>
      </div>
    </RightPanel>
  )
}
