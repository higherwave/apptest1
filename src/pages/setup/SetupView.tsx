import { Button, ClickableTile, InlineNotification, Loading, ProgressBar } from '@carbon/react'
import type { Setup } from '../../api/client'
import { RightPanel } from '../../components/RightPanel'
import { ORDER, SETUP, STEPS, type SetupKey } from './setupText'
import { SetupStep } from './SetupSteps'
import styles from './SetupView.module.scss'

export type SetupViewProps = {
  state: 'loading' | 'error' | 'ready'
  setup?: Setup
  errorText?: string
  open: SetupKey | null
  step: number
  busy: boolean
  error?: string
  confirmed: boolean[]
  onConfirm: (index: number, on: boolean) => void
  onOpen: (key: SetupKey) => void
  onClose: () => void
  onStep: (step: number) => void
  onFinish: (status: 'done' | 'skipped') => void
  onNext: () => void
}

const STATUS_LABEL = { current: 'In progress', done: 'Done', locked: 'Locked', skipped: 'Skipped' } as const

// Presentational: workspace setup on one screen. Level one is the five categories as cards, in order, the ones ahead locked. Level two is a panel from the right with
// the category's own steps; Continue carries on from step to step and from category to category, so nobody goes back to the cards in between.
export function SetupView(p: SetupViewProps) {
  if (p.state === 'loading') return <Loading small withOverlay={false} description="Loading setup" />
  if (p.state === 'error' || !p.setup) return <InlineNotification kind="warning" lowContrast hideCloseButton title="Setup" subtitle={p.errorText} />
  const s = p.setup
  const cat = p.open ? s.categories.find((c) => c.key === p.open) : undefined
  const meta = p.open ? SETUP[p.open] : undefined
  const checks = cat ? (cat.key === 'guard' ? p.confirmed.map((ok, i) => ({ label: ['I have read how long things are kept', 'I know where the AI limit is', 'I understand the project lock'][i], ok })) : cat.checks) : []
  const blocking = !!cat && !cat.optional && checks.some((c) => !c.ok)
  const finished = cat?.status === 'done' || cat?.status === 'skipped'
  const last = p.open === ORDER[ORDER.length - 1]

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <p className={styles.group}>Getting started</p>
        <h1 className={styles.title}>Set up your workspace</h1>
        <p className={styles.lead}>Five short steps, in order, so people can sign in, launches have someone to answer them and the first research project has a place to land. Everyone else you invite gets the guided tours.</p>
        <div className={styles.progress} data-testid="setup-progress">
          <ProgressBar label="Setup progress" hideLabel size="small" value={s.done} max={s.total} />
          <span>{s.complete ? 'Your workspace is set up' : `${s.done} of ${s.total} done`}</span>
        </div>
      </header>

      <div className={styles.grid}>
        {s.categories.map((c, i) => (
          <ClickableTile key={c.key} className={styles.card} data-status={c.status} data-testid={`setup-card-${c.key}`} disabled={c.status === 'locked'} onClick={() => p.onOpen(c.key)}>
            <span className={styles.top}>
              <span className={styles.num}>{c.status === 'done' || c.status === 'skipped' ? '✓' : i + 1}</span>
              <span className={styles.status}>{STATUS_LABEL[c.status]}</span>
            </span>
            <span className={styles.text}>
              <span className={styles.name}>{SETUP[c.key].title}</span>
              <span className={styles.desc}>{SETUP[c.key].desc}</span>
              <span className={styles.who}>{SETUP[c.key].who}</span>
            </span>
          </ClickableTile>
        ))}
      </div>

      <RightPanel open={p.open !== null} wide heading={meta?.title ?? ''} label="Workspace setup" onClose={p.onClose}>
        {p.open && cat && meta && (
          <div className={styles.drawer} data-testid="setup-drawer">
            <nav className={styles.rail} aria-label="Steps">
              {STEPS.map((name, i) => (
                <span key={name} className={styles.st} data-state={i === p.step ? 'current' : i < p.step ? 'done' : 'next'} aria-current={i === p.step ? 'step' : undefined}>
                  <b>{i < p.step ? '✓' : i + 1}</b>
                  {name}
                </span>
              ))}
            </nav>
            <div className={styles.main}>
              <div className={styles.body} data-testid={`setup-step-${STEPS[p.step].toLowerCase().replace(' ', '-')}`}>
                {p.step === 0 && (
                  <>
                    <p className={styles.lead}>{meta.desc}</p>
                    <ul className={styles.welcome}>{meta.welcome.map((w) => <li key={w}>{w}</li>)}</ul>
                    <p className={styles.meta}>{meta.who}. You can close this and come back; where you are is kept.</p>
                  </>
                )}
                {p.step === 1 && <SetupStep category={p.open} confirmed={p.confirmed} onConfirm={p.onConfirm} />}
                {p.step === 2 && (
                  <>
                    <p className={styles.lead}>{cat.key === 'guard' ? 'What you have confirmed' : 'What we found in your workspace'}</p>
                    <ul className={styles.checks} data-testid="setup-checks">
                      {checks.map((c) => <li key={c.label} data-ok={c.ok}><span>{c.label}</span><span>{c.ok ? '✓ Done' : cat.optional ? 'Not yet (optional)' : 'Not yet'}</span></li>)}
                    </ul>
                    {blocking && <p className={styles.meta}>Go back to Set up and finish the items that say Not yet. This page checks again each time you open it.</p>}
                  </>
                )}
                {p.step === 3 && (
                  <>
                    <p className={styles.lead}>{cat.status === 'skipped' ? `${meta.title} skipped. You can set it up later from Admin.` : finished ? `${meta.title} is done.` : `${meta.title} is not marked done yet.`}</p>
                    {!last && finished && <p className={styles.meta}>Next: {SETUP[ORDER[ORDER.indexOf(cat.key) + 1]].title}.</p>}
                    {last && finished && <p className={styles.meta}>That was the last one. Your workspace is set up.</p>}
                  </>
                )}
                {p.error && <InlineNotification kind="error" lowContrast hideCloseButton title="Not saved" subtitle={p.error} />}
              </div>
              <div className={styles.foot}>
                <Button kind="ghost" size="md" disabled={p.step === 0} onClick={() => p.onStep(p.step - 1)}>Back</Button>
                {cat.optional && !finished && p.step < 3 ? <Button kind="ghost" size="md" disabled={p.busy} onClick={() => p.onFinish('skipped')} data-testid="setup-skip">Skip for now</Button> : <span />}
                {p.step < 2 && <Button kind="primary" size="md" onClick={() => p.onStep(p.step + 1)} data-testid="setup-continue">Continue</Button>}
                {p.step === 2 && <Button kind="primary" size="md" disabled={blocking || p.busy} onClick={() => p.onFinish('done')} data-testid="setup-done">{p.busy ? 'Saving…' : 'Mark as done'}</Button>}
                {p.step === 3 && <Button kind="primary" size="md" onClick={p.onNext} data-testid="setup-next">{last ? 'Finish' : 'Next category'}</Button>}
              </div>
            </div>
          </div>
        )}
      </RightPanel>
    </div>
  )
}
