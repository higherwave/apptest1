import { Close, LogoSlack } from '@carbon/icons-react'
import { Button, InlineNotification, Loading, Modal, RadioButton, Tab, TabList, TabPanel, TabPanels, Tabs, Tag, TextArea, TextInput } from '@carbon/react'
import { useEffect, useState } from 'react'
import type { LaunchAnswer, LaunchDetail, LaunchDigest, LaunchDigestShared, LaunchRequestResult, LaunchSlackResult, LaunchStep } from '../../api/client'
import { answersFor, rationaleRequired } from '../../../shared/launch.mjs'
import { ProjectHeader } from '../project/ProjectHeader'
import { dayText, KIND_LABEL, momentText, reviewersLine, stateLabel, stateTag } from './launchText'
import { FollowPanel } from './FollowPanel'
import styles from './LaunchView.module.scss'

export type LaunchViewProps = {
  state: 'loading' | 'error' | 'ready'
  launch?: LaunchDetail
  errorText?: string
  busy: boolean
  /** Each resolves true when it was saved, so the form can close. */
  onAnswer: (step: string, answer: string, rationale: string) => Promise<boolean>
  onAddLink: (step: string, title: string, url: string) => Promise<boolean>
  onRemoveLink: (linkId: string) => void
  onSetUp: (body: { name: string; targetDate: string | null; briefNotes: string }) => Promise<boolean>
  /** Asks, by email, the reviewers of the steps still waiting. Resolves with who was asked, or null if it failed. */
  onRequest: () => Promise<LaunchRequestResult | null>
  /** Opens the launch's thread in its team's Slack channel. Resolves with what happened, or null if the call failed. */
  onSlack: () => Promise<LaunchSlackResult | null>
  /** Following: add people, remove one, preview the early digest and share it. */
  onFollowAdd: (userIds: string[]) => Promise<boolean>
  onFollowRemove: (userId: string) => void
  onPreviewDigest: () => Promise<LaunchDigest | null>
  onShareDigest: (via: { email: boolean; slack: boolean }) => Promise<LaunchDigestShared | null>
  /** The step an email link pointed at (?step=): scrolled to, with what is true of it now. */
  focusStep?: string | null
  /** The address of Admin, Members, Reviewers, for an owner who finds a step with no reviewer. */
  reviewersHref?: string
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

// One answer in the record: why, by whom and when; and, on a final decision, the steps it went past. The current answer's label is the tag at the top
// right of its card, so it is not repeated here; an earlier answer, or one the brief has reopened, carries its own.
function AnswerBlock({ answer, step, showTag }: { answer: LaunchAnswer; step: string; showTag: boolean }) {
  return (
    <div className={styles.answer} data-testid={`answer-${step}`}>
      <p className={styles.answerHead}>
        {showTag && <Tag size="sm" type={stateTag(answer.answer)}>{stateLabel(answer.answer)}</Tag>}
        <span className={styles.by}>{answer.by?.name ?? 'Someone'} · {momentText(answer.at)}</span>
      </p>
      {answer.rationale && <p className={styles.rationale}>{answer.rationale}</p>}
      {answer.openItems && answer.openItems.length > 0 && (
        <div className={styles.openItems}>
          <p className={styles.small}>Went past these open steps:</p>
          <ul>
            {answer.openItems.map((i) => (
              <li key={i.step}>
                <strong>{i.label}</strong> ({stateLabel(i.state).toLowerCase()}){i.rationale ? `: ${i.rationale}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Section({ step, focus, busy, reviewersHref, onAnswer, onAddLink, onRemoveLink }: { step: LaunchStep; focus: boolean } & Pick<LaunchViewProps, 'busy' | 'reviewersHref' | 'onAnswer' | 'onAddLink' | 'onRemoveLink'>) {
  const [mode, setMode] = useState<'idle' | 'answer' | 'link'>('idle')
  const [choice, setChoice] = useState<string>('')
  const [why, setWhy] = useState('')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [showEarlier, setShowEarlier] = useState(false)
  const choices = answersFor(step.step) as { key: string; label: string }[]
  const needsWhy = !!choice && rationaleRequired(choice)
  const canSave = !!choice && (!needsWhy || why.trim().length > 0) && !busy
  const close = () => { setMode('idle'); setChoice(''); setWhy(''); setTitle(''); setUrl('') }
  const reopened = step.state === 'reopened'
  return (
    <article className={styles.section} data-testid={`section-${step.step}`} data-state={step.state} data-focus={focus || undefined} aria-label={step.label}>
      <header className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>{step.label}</h3>
        <Tag size="sm" type={stateTag(step.state)} data-testid={`state-${step.step}`}>{stateLabel(step.state)}</Tag>
      </header>
      <p className={styles.reviewers}>
        {step.used ? <><span className={styles.small}>Reviewer:</span> {reviewersLine(step.reviewers.primary, step.reviewers.alternate)}</> : 'This team’s launches do not use this step.'}
      </p>
      {step.state === 'missing' && (
        <InlineNotification
          kind="warning"
          lowContrast
          hideCloseButton
          title="Approver missing"
          subtitle={reviewersHref ? 'Nobody is set up to answer this step. An owner can add a reviewer.' : 'Nobody is set up to answer this step. Ask a workspace owner to add a reviewer.'}
        />
      )}
      {step.answer && <AnswerBlock answer={step.answer} step={step.step} showTag={reopened} />}
      {reopened && <p className={styles.reopened}>The brief changed after this answer was given. {step.canAnswer ? 'Please confirm it, or answer again.' : 'The reviewer is asked to confirm it.'}</p>}
      {step.links.length > 0 && (
        <ul className={styles.links} aria-label={`Links for ${step.label}`}>
          {step.links.map((l) => (
            <li key={l.id}>
              <a href={l.url} target="_blank" rel="noreferrer">{l.title}</a>
              {step.canAnswer && <Button kind="ghost" size="sm" hasIconOnly renderIcon={Close} iconDescription={`Remove ${l.title}`} tooltipPosition="left" onClick={() => onRemoveLink(l.id)} />}
            </li>
          ))}
        </ul>
      )}
      {step.earlier.length > 0 && (
        <div>
          <Button kind="ghost" size="sm" aria-expanded={showEarlier} onClick={() => setShowEarlier(!showEarlier)}>
            {showEarlier ? 'Hide earlier answers' : `Earlier answers (${step.earlier.length})`}
          </Button>
          {showEarlier && step.earlier.map((a) => <AnswerBlock key={a.id} answer={a} step={step.step} showTag />)}
        </div>
      )}
      {step.canAnswer && mode === 'idle' && (
        <div className={styles.actions}>
          <Button kind="primary" size="sm" data-testid={`answer-button-${step.step}`} onClick={() => setMode('answer')}>
            {step.answer ? 'Answer again' : 'Answer'}
          </Button>
          <Button kind="tertiary" size="sm" data-testid={`link-button-${step.step}`} onClick={() => setMode('link')}>
            Add a link
          </Button>
        </div>
      )}
      {step.canAnswer && mode === 'answer' && (
        <form
          className={styles.form}
          aria-label={`Answer for ${step.label}`}
          onSubmit={async (e) => {
            e.preventDefault()
            if (canSave && (await onAnswer(step.step, choice, why))) close()
          }}
        >
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Your answer</legend>
            <div className={styles.choices}>
              {choices.map((c) => (
                <RadioButton key={c.key} id={`answer-${step.step}-${c.key}`} name={`answer-${step.step}`} labelText={c.label} value={c.key} checked={choice === c.key} onChange={() => setChoice(c.key)} />
              ))}
            </div>
          </fieldset>
          <TextArea
            id={`why-${step.step}`}
            labelText={needsWhy ? 'Why (needed for this answer)' : 'Why (optional)'}
            rows={3}
            value={why}
            maxCount={4000}
            invalid={needsWhy && why.trim().length === 0 && why.length > 0}
            onChange={(e) => setWhy(e.target.value)}
          />
          <div className={styles.actions}>
            <Button type="submit" kind="primary" size="sm" disabled={!canSave} data-testid={`save-answer-${step.step}`}>
              {busy ? 'Saving…' : 'Save answer'}
            </Button>
            <Button kind="ghost" size="sm" onClick={close}>Cancel</Button>
          </div>
        </form>
      )}
      {step.canAnswer && mode === 'link' && (
        <form
          className={styles.form}
          aria-label={`Add a link for ${step.label}`}
          onSubmit={async (e) => {
            e.preventDefault()
            if (url.trim() && !busy && (await onAddLink(step.step, title, url))) close()
          }}
        >
          <TextInput id={`link-title-${step.step}`} labelText="What it is (optional)" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          <TextInput id={`link-url-${step.step}`} labelText="Link" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
          <div className={styles.actions}>
            <Button type="submit" kind="primary" size="sm" disabled={!url.trim() || busy} data-testid={`save-link-${step.step}`}>Add link</Button>
            <Button kind="ghost" size="sm" onClick={close}>Cancel</Button>
          </div>
        </form>
      )}
    </article>
  )
}

// The launch's Slack thread, above the summary: the logo and one link, so the conversation is a click away. Before the thread exists, an editor can open it.
function SlackCard({ launch, busy, onOpen }: { launch: LaunchDetail; busy: boolean; onOpen: () => void }) {
  const { channel, threadUrl, started } = launch.slack
  if (!channel) return null
  return (
    <div className={styles.slackCard} data-testid="launch-slack">
      <LogoSlack size={32} className={styles.slackLogo} aria-hidden />
      {threadUrl ? (
        <a className={styles.slackLink} href={threadUrl} target="_blank" rel="noreferrer" data-testid="open-slack-thread">Open the Slack thread</a>
      ) : started ? (
        <span className={styles.slackText}>The thread is in #{channel}</span>
      ) : launch.you.canSetUp ? (
        <Button kind="tertiary" size="sm" disabled={busy} onClick={onOpen} data-testid="start-slack">Open a thread in #{channel}</Button>
      ) : (
        <span className={styles.slackText}>No thread yet in #{channel}</span>
      )}
    </div>
  )
}

function Summary({ launch, onEdit, onAsk }: { launch: LaunchDetail; onEdit: () => void; onAsk: () => void }) {
  const s = launch.summary
  const rows: { key: string; label: string; n: number }[] = [
    { key: 'ready', label: 'Ready', n: s.counts.ready },
    { key: 'ready_with_conditions', label: 'Ready with conditions', n: s.counts.conditions },
    { key: 'not_applicable', label: 'Not applicable', n: s.counts.notApplicable },
    { key: 'changes_needed', label: 'Changes needed', n: s.counts.changes },
    { key: 'reopened', label: 'Reopened', n: s.counts.reopened },
    { key: 'waiting', label: 'Waiting', n: s.counts.waiting },
    { key: 'missing', label: 'Approver missing', n: s.counts.missing },
  ]
  const external = launch.you.kind === 'external'
  // The colour says at a glance how it stands: green once it is a go, coral while something holds it back or it is a no-go, cream when the brief has
  // reopened answers, and neutral otherwise.
  const tone = s.state === 'no_go' || s.blocking.length > 0 ? 'coral' : s.state === 'go' || s.state === 'go_with_conditions' ? 'mint' : s.state === 'reopened' ? 'cream' : 'soft'
  return (
    <div className={styles.summary} data-testid="launch-summary">
      <div className={styles.standing} data-tone={tone}>
        <p className={styles.eyebrow}>Where it stands</p>
        <p className={styles.big} data-testid="launch-state">{stateLabel(s.state)}</p>
        {!external && (
          <ul className={styles.counts} aria-label="Steps by state">
            {rows.filter((r) => r.n > 0).map((r) => (
              <li key={r.key} data-state={r.key}><strong>{r.n}</strong> {r.label.toLowerCase()}</li>
            ))}
          </ul>
        )}
        {!external && s.blocking.length > 0 && (
          <div className={styles.group} data-testid="launch-blocking">
            <p className={styles.eyebrow}>Holding it back</p>
            <ul className={styles.plain}>
              {s.blocking.map((b) => <li key={b.step}>{b.label}: {stateLabel(b.state).toLowerCase()}</li>)}
            </ul>
          </div>
        )}
        {!external && s.waitingOn.length > 0 && (
          <div className={styles.group} data-testid="launch-waiting">
            <p className={styles.eyebrow}>Waiting on</p>
            <ul className={styles.plain}>
              {s.waitingOn.map((w) => <li key={w.step}>{w.label}</li>)}
            </ul>
          </div>
        )}
      </div>
      <dl className={styles.facts}>
        <div><dt>Target date</dt><dd>{dayText(launch.targetDate) ?? 'Not set'}</dd></div>
        <div><dt>Brief last changed</dt><dd>{momentText(launch.briefAt)}</dd></div>
        <div><dt>Project</dt><dd>{launch.projectName}{launch.teamName ? ` · ${launch.teamName}` : ''}</dd></div>
      </dl>
      <p className={styles.small}>{KIND_LABEL[launch.you.kind]}{launch.you.steps.length ? `: ${launch.you.steps.map((k) => launch.steps.find((x) => x.step === k)?.label ?? k).join(', ')}` : ''}</p>
      <div className={styles.actions}>
        {launch.you.canSetUp && <Button kind="primary" size="sm" onClick={onAsk} data-testid="ask-answers">Ask for answers</Button>}
        {launch.you.canSetUp && <Button kind="tertiary" size="sm" onClick={onEdit} data-testid="edit-launch">Edit launch details</Button>}
        {launch.you.kind !== 'external' && <Button kind="tertiary" size="sm" href={`/api/v1/launches/${launch.id}/export.pdf`} data-testid="download-pdf">Download PDF</Button>}
      </div>
    </div>
  )
}

function Brief({ launch }: { launch: LaunchDetail }) {
  const b = launch.brief
  const external = launch.you.kind === 'external'
  return (
    <div className={styles.brief} data-testid="launch-brief">
      {launch.briefNotes ? (
        <>
          <p className={styles.eyebrow}>{external ? 'What you need to know' : 'Notes for reviewers'}</p>
          <p className={styles.notes}>{launch.briefNotes}</p>
        </>
      ) : (
        <p className={styles.small}>{external ? 'No notes have been added for you yet.' : 'No notes yet. The launch owner can add what reviewers should know.'}</p>
      )}
      {!external && (
        <>
          {!b.published && <p className={styles.small}>The requirements are not published yet. Once they are, what is being built appears here.</p>}
          {b.problem && <><p className={styles.eyebrow}>The problem</p><p className={styles.notes}>{b.problem}</p></>}
          {b.users && <><p className={styles.eyebrow}>Who it is for</p><p className={styles.notes}>{b.users}</p></>}
          {b.goals && b.goals.length > 0 && (
            <>
              <p className={styles.eyebrow}>Goals</p>
              <ul className={styles.plain}>{b.goals.map((g) => <li key={g}>{g}</li>)}</ul>
            </>
          )}
          {b.requirements.length > 0 && (
            <>
              <p className={styles.eyebrow}>What is being built</p>
              <ul className={styles.plain}>
                {b.requirements.map((r) => <li key={r.key}><strong>{r.key}</strong> {r.title}</li>)}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  )
}

// What is true now of the step an email link pointed at: a request that has since been answered says who answered it, so the link is never a dead end.
function focusText(launch: LaunchDetail, key: string): string | null {
  const s = launch.steps.find((x) => x.step === key)
  if (!s) return null
  if (!s.used) return `This team’s launches do not use ${s.label}.`
  if (s.state === 'missing') return `${s.label} has no reviewer yet.`
  if (s.state === 'reopened') return s.canAnswer ? `The brief changed after ${s.label} was answered. Please confirm it, or answer again.` : `The brief changed after ${s.label} was answered. Its reviewer is asked to confirm it.`
  if (s.answer) return `${s.label} was answered by ${s.answer.by?.name ?? 'someone'} on ${momentText(s.answer.at)}: ${stateLabel(s.answer.answer).toLowerCase()}.${s.canAnswer ? ' You can answer again below.' : ''}`
  return s.canAnswer ? `Your answer is wanted on ${s.label}.` : `${s.label} is waiting for ${reviewersLine(s.reviewers.primary, s.reviewers.alternate)}.`
}

// Presentational: a launch as its steps' go signals. Every section is visible to everyone with access; only a step's reviewer can change it.
// The summary at the right says at a glance whether the launch is ready; the brief is what the answers were given on.
export function LaunchView(p: LaunchViewProps) {
  const { launch } = p
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [notes, setNotes] = useState('')
  const [asking, setAsking] = useState(false)
  const [asked, setAsked] = useState<LaunchRequestResult | null>(null)
  const [slackProblem, setSlackProblem] = useState<string | null>(null)
  const dateOk = date.trim() === '' || DAY.test(date.trim())
  // An email link opens at one step: bring it into view once the launch is there.
  useEffect(() => {
    if (!p.focusStep || !launch) return
    document.querySelector(`[data-testid="section-${p.focusStep}"]`)?.scrollIntoView({ block: 'center' })
  }, [p.focusStep, launch?.id])
  const focus = p.focusStep && launch ? focusText(launch, p.focusStep) : null
  // Who an "Ask for answers" would reach: the primary reviewer of each step still waiting or reopened, one entry per person.
  const toAsk = (() => {
    const by = new Map<string, { name: string; steps: string[] }>()
    for (const st of launch?.steps ?? []) {
      if (!st.used || (st.state !== 'waiting' && st.state !== 'reopened')) continue
      for (const person of st.reviewers.primary) by.set(person.userId, { name: person.name, steps: [...(by.get(person.userId)?.steps ?? []), st.label] })
    }
    return [...by.values()]
  })()
  const withoutReviewer = (launch?.steps ?? []).filter((st) => st.used && st.state === 'missing')
  const openSlack = async () => {
    setSlackProblem(null)
    const r = await p.onSlack()
    if (r && r.state !== 'started' && r.state !== 'already') setSlackProblem(r.problem ?? 'Slack could not be reached.')
  }
  const openEdit = () => {
    if (!launch) return
    setName(launch.name)
    setDate(launch.targetDate ?? '')
    setNotes(launch.briefNotes)
    setEditing(true)
  }
  return (
    <div className={styles.page}>
      <ProjectHeader title="Launch" description="The go signals from each function, with the evidence behind them. Everyone sees every section; each step’s reviewer answers their own." />
      {p.errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Not saved" subtitle={p.errorText} />}
      {p.state === 'loading' && <Loading small withOverlay={false} description="Loading the launch" />}
      {p.state === 'error' && !p.errorText && <p className={styles.small}>The launch could not be loaded.</p>}
      {p.state === 'ready' && launch && (
        <>
          <h2 className={styles.launchName} data-testid="launch-name">{launch.name}</h2>
          {focus && <InlineNotification kind="info" lowContrast hideCloseButton title="From your email" subtitle={focus} data-testid="focus-banner" />}
          {slackProblem && <InlineNotification kind="warning" lowContrast title="The Slack thread was not opened" subtitle={slackProblem} onCloseButtonClick={() => setSlackProblem(null)} data-testid="slack-problem" />}
          {asked && (
            <InlineNotification
              kind="success"
              lowContrast
              title={asked.asked.length ? `Asked ${asked.asked.length} ${asked.asked.length === 1 ? 'reviewer' : 'reviewers'}` : asked.held.length ? 'Nobody was emailed' : 'Nobody new to ask'}
              subtitle={[
                asked.asked.length ? asked.asked.map((a) => `${a.name} (${a.steps.join(', ')})`).join('; ') : '',
                asked.alreadyAsked.length ? `${asked.alreadyAsked.length} already asked for this brief.` : '',
                asked.held.length ? `${asked.held.length} not emailed (a placeholder address, or the temporary recipient limit).` : '',
                asked.missing.length ? `No reviewer for ${asked.missing.map((m) => m.label).join(', ')}.` : '',
              ].filter(Boolean).join(' ')}
              onCloseButtonClick={() => setAsked(null)}
              data-testid="asked-result"
            />
          )}
          <div className={styles.layout}>
            <div className={styles.sections}>
              {launch.steps.map((s) => (
                <Section key={s.step} step={s} focus={s.step === p.focusStep} busy={p.busy} reviewersHref={p.reviewersHref} onAnswer={p.onAnswer} onAddLink={p.onAddLink} onRemoveLink={p.onRemoveLink} />
              ))}
            </div>
            <div className={styles.rail}>
            {launch.you.kind !== 'external' && <SlackCard launch={launch} busy={p.busy} onOpen={openSlack} />}
            <aside className={styles.aside} aria-label="Summary and brief">
              <Tabs>
                <TabList aria-label="Launch panel">
                  <Tab data-testid="tab-summary">Summary</Tab>
                  <Tab data-testid="tab-brief">Brief</Tab>
                  {launch.you.kind !== 'external' && <Tab data-testid="tab-follow">Follow</Tab>}
                </TabList>
                <TabPanels>
                  <TabPanel className={styles.tabPanel}><Summary launch={launch} onEdit={openEdit} onAsk={() => { setAsked(null); setAsking(true) }} /></TabPanel>
                  <TabPanel className={styles.tabPanel}><Brief launch={launch} /></TabPanel>
                  {launch.you.kind !== 'external' && <TabPanel className={styles.tabPanel}><FollowPanel launch={launch} busy={p.busy} onAdd={p.onFollowAdd} onRemove={p.onFollowRemove} onPreview={p.onPreviewDigest} onShare={p.onShareDigest} /></TabPanel>}
                </TabPanels>
              </Tabs>
            </aside>
            </div>
          </div>
          <Modal
            open={asking}
            size="sm"
            modalHeading="Ask for answers"
            primaryButtonText={p.busy ? 'Asking…' : toAsk.length ? 'Ask by email' : 'Close'}
            secondaryButtonText="Cancel"
            primaryButtonDisabled={p.busy}
            onRequestClose={() => setAsking(false)}
            onRequestSubmit={async () => {
              if (!toAsk.length) { setAsking(false); return }
              const result = await p.onRequest()
              setAsking(false)
              if (result) setAsked(result)
            }}
          >
            <div className={styles.modalForm} data-testid="ask-dialog">
              {toAsk.length ? (
                <>
                  <p className={styles.notes}>These reviewers get one email each, with a link to their step:</p>
                  <ul className={styles.plain}>{toAsk.map((a) => <li key={a.name}><strong>{a.name}</strong>: {a.steps.join(', ')}</li>)}</ul>
                </>
              ) : (
                <p className={styles.notes}>No step is waiting on a reviewer who can be asked.</p>
              )}
              {withoutReviewer.length > 0 && <p className={styles.notes}>No reviewer is set up for {withoutReviewer.map((x) => x.label).join(', ')}, so nobody can be asked. An owner can add one under Admin, Members, Reviewers.</p>}
            </div>
          </Modal>
          <Modal
            open={editing}
            size="md"
            modalHeading="Launch details"
            primaryButtonText={p.busy ? 'Saving…' : 'Save'}
            secondaryButtonText="Cancel"
            primaryButtonDisabled={p.busy || !name.trim() || !dateOk}
            onRequestClose={() => setEditing(false)}
            onRequestSubmit={async () => {
              if (await p.onSetUp({ name: name.trim(), targetDate: date.trim() || null, briefNotes: notes })) setEditing(false)
            }}
          >
            <div className={styles.modalForm}>
              <TextInput id="launch-name" labelText="Name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              <TextInput id="launch-date" labelText="Target date" placeholder="2026-12-01" helperText="A day, like 2026-12-01. Leave empty if there is none yet." value={date} invalid={!dateOk} invalidText="Use a date like 2026-12-01." onChange={(e) => setDate(e.target.value)} />
              <TextArea id="launch-notes" labelText="Notes for reviewers" helperText="What they should know. Changing these notes changes the brief: answers given on the old one are asked for again." rows={6} value={notes} maxCount={8000} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </Modal>
        </>
      )}
    </div>
  )
}
