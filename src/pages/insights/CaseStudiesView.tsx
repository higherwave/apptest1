import { ChevronDown, ChevronUp } from '@carbon/icons-react'
import { Button, InlineNotification, Loading, Tag, TextArea } from '@carbon/react'
import { useState } from 'react'
import type { CaseBrief, CaseStudy } from '../../api/client'
import { InsightsHeader } from './InsightsHeader'
import styles from './CaseStudiesView.module.scss'

export type CaseStudiesViewProps = {
  state: 'loading' | 'error' | 'empty' | 'ready'
  cases: CaseStudy[]
  briefs: CaseBrief[]
  errorText?: string
  /** Puts text on the clipboard; false when the browser would not. */
  onCopy: (text: string) => Promise<boolean>
  onOpenTheme: (id: string) => void
}

// "Sep 2026" from a YYYY-MM-DD date; the day is not meaningful.
const monthYear = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '')
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const PROMPT_HINT = 'Copy a prompt to paste into an AI tool such as Claude Design, which can use it to build a PPTX deck for this case study.'

// The row's Copy prompt button, with a hover tooltip saying what the prompt is for. If the browser refuses the clipboard, the prompt is shown to copy by hand.
function CopyPrompt({ prompt, onCopy, id }: { prompt: string; onCopy: CaseStudiesViewProps['onCopy']; id: string }) {
  const [done, setDone] = useState<'copied' | 'failed' | null>(null)
  return (
    <div className={styles.copy}>
      <Button
        kind="secondary"
        size="sm"
        title={PROMPT_HINT}
        onClick={async () => {
          setDone((await onCopy(prompt)) ? 'copied' : 'failed')
        }}
      >
        Copy prompt
      </Button>
      <span className={styles.copyNote} role="status">
        {done === 'copied' && 'Copied'}
      </span>
      {done === 'failed' && <TextArea id={id} labelText="Select and copy this prompt" rows={6} readOnly value={prompt} />}
    </div>
  )
}

// One accordion row: the name and a line on how it turned out, the chevron, and the copy button beside them (a button must not sit in a button).
function Row({ id, name, outcome, prompt, open, onToggle, onCopy, children }: { id: string; name: string; outcome: string | null; prompt: string; open: boolean; onToggle: () => void; onCopy: CaseStudiesViewProps['onCopy']; children: React.ReactNode }) {
  return (
    <li className={styles.item} data-testid={`case-row-${id}`} data-open={open}>
      <div className={styles.head}>
        <h3 className={styles.itemHead}>
          <Button kind="ghost" size="md" className={styles.headButton} renderIcon={open ? ChevronUp : ChevronDown} aria-expanded={open} aria-controls={`case-body-${id}`} onClick={onToggle}>
            <span className={styles.headText}>
              <span className={styles.name}>{name}</span>
              {outcome && <span className={styles.outcome}>{outcome}</span>}
            </span>
          </Button>
        </h3>
        <CopyPrompt prompt={prompt} onCopy={onCopy} id={`case-prompt-${id}`} />
      </div>
      {open && (
        <div id={`case-body-${id}`} className={styles.body}>
          {children}
        </div>
      )}
    </li>
  )
}

// A project's brief opened: the problem, what people said, what was decided and designed across the top, then what happened across the full width.
function BriefBody({ brief }: { brief: CaseBrief }) {
  return (
    <>
      <div className={styles.briefGrid}>
        <section aria-label="The problem" className={styles.briefSection}>
          <h4 className={styles.label}>The problem</h4>
          <p className={styles.small}>{brief.template ?? 'Research study'} · {plural(brief.sessions, 'session')} · {plural(brief.participants, 'participant')}</p>
          {brief.problem.length === 0 && <p className={styles.small}>No themes yet. Analyze the project’s transcripts first.</p>}
          {brief.problem.map((t) => (
            <p key={t.title} className={styles.item2}>
              {t.title} <span className={styles.small}>· {t.participantCount} of {t.totalParticipants} participants</span>
            </p>
          ))}
        </section>
        <section aria-label="What people said" className={styles.briefSection}>
          <h4 className={styles.label}>What people said</h4>
          {brief.evidence.map((q) => (
            <blockquote key={q.text} className={styles.quote}>
              <p className={styles.quoteText}>“{q.text}”</p>
              <p className={styles.quoteMeta}>{q.speaker} · on “{q.themeTitle}”</p>
            </blockquote>
          ))}
        </section>
        <section aria-label="What we decided" className={styles.briefSection}>
          <h4 className={styles.label}>What we decided</h4>
          {!brief.decisions && <p className={styles.small}>Nothing yet: the requirements are not published.</p>}
          {brief.decisions?.requirements.map((r) => (
            <p key={r.key} className={styles.item2}>
              <strong>{r.key}</strong> {r.title} <span className={styles.small}>· {r.priority} priority</span>
            </p>
          ))}
          {brief.decisions?.alternatives.map((a) => (
            <p key={a.title} className={styles.small}>Considered and rejected: {a.title}</p>
          ))}
        </section>
        <section aria-label="What we designed" className={styles.briefSection}>
          <h4 className={styles.label}>What we designed</h4>
          {brief.designs.length === 0 && <p className={styles.small}>No prototypes or design notes yet.</p>}
          {brief.designs.map((d) => (
            <p key={d.key} className={styles.item2}>
              <strong>{d.key}</strong> {d.title}
              {d.prototypeUrl && (
                <>
                  {' '}
                  <a href={d.prototypeUrl} target="_blank" rel="noopener noreferrer">Open prototype ↗</a>
                </>
              )}
            </p>
          ))}
        </section>
      </div>
      <section aria-label="What happened" className={styles.happened}>
        <h4 className={styles.label}>What happened</h4>
        {(!brief.results || brief.results.items.length === 0) && <p className={styles.small}>Nothing has been measured yet.</p>}
        <div className={styles.results}>
          {brief.results?.items.map((r) => (
            <div key={r.key} className={styles.result}>
              <p className={styles.item2}>
                <strong>{r.key}</strong> {r.metric ?? r.title}
              </p>
              <p className={styles.small}>
                {r.baseline ? `Before ${r.baseline}` : ''}
                {r.baseline && r.target ? ' · ' : ''}
                {r.target ? `Goal ${r.target}` : ''}
                {r.latest ? ` · Latest (${r.latest.on}): ${r.latest.value}` : ''}
              </p>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

// A case study written by hand, opened: what the team did, what it was based on and some of the words, then the outcome across the full width.
function StudyBody({ study, onOpenTheme }: { study: CaseStudy; onOpenTheme: CaseStudiesViewProps['onOpenTheme'] }) {
  return (
    <>
      <div className={styles.briefGrid}>
        <section aria-label="What the team did" className={styles.briefSection}>
          <h4 className={styles.label}>What the team did</h4>
          <p className={styles.small}>{[study.ownerTeam, monthYear(study.date)].filter(Boolean).join(' · ')}</p>
          <p className={styles.item2}>{study.summary}</p>
        </section>
        <section aria-label="Based on" className={styles.briefSection}>
          <h4 className={styles.label}>
            Based on
            {study.opportunities > 0 && <Tag size="sm" type="purple">{plural(study.opportunities, 'opportunity', 'opportunities')} still open</Tag>}
          </h4>
          <div className={styles.themes}>
            {study.themes.map((t) => (
              <Button key={t.id} kind="tertiary" size="sm" onClick={() => onOpenTheme(t.id)}>
                {t.title}
              </Button>
            ))}
          </div>
        </section>
        <section aria-label="What people said" className={styles.briefSection}>
          <h4 className={styles.label}>What people said</h4>
          {study.quotes.length === 0 && <p className={styles.small}>No quotes yet.</p>}
          {study.quotes.map((q) => (
            <blockquote key={q.id} className={styles.quote}>
              <p className={styles.quoteText}>“{q.text}”</p>
              <p className={styles.quoteMeta}>{q.speaker} · {q.session}</p>
            </blockquote>
          ))}
        </section>
      </div>
      <section aria-label="What happened" className={styles.happened}>
        <h4 className={styles.label}>What happened</h4>
        <p className={styles.item2}>{study.outcome}</p>
      </section>
    </>
  )
}

// Presentational: a row for each analysed project and for each case study written by hand. Each row opens to the same layout.
export function CaseStudiesView({ state, cases, briefs, errorText, onCopy, onOpenTheme }: CaseStudiesViewProps) {
  const [opened, setOpened] = useState<Set<string>>(new Set())
  const [started, setStarted] = useState(false)
  // The first row opens, so the page does not start as a closed list.
  if (!started && state === 'ready' && (briefs[0] || cases[0])) {
    setStarted(true)
    setOpened(new Set([briefs[0] ? `p-${briefs[0].projectId}` : `c-${cases[0].id}`]))
  }
  const toggle = (id: string) => setOpened((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const all = [...briefs.map((b) => `p-${b.projectId}`), ...cases.map((c) => `c-${c.id}`)]
  return (
    <div className={styles.page}>
      <InsightsHeader title="Case Studies" description="What the team changed because of what it learned" />
      {errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Something went wrong" subtitle={errorText} />}
      {state === 'loading' && <Loading small withOverlay={false} description="Loading case studies" />}
      {state === 'empty' && <p className={styles.small}>No case studies yet. A project appears here once something it shipped has worked: the newest finding on a requirement in Measure says Worked, and none needs attention.</p>}
      {state === 'ready' && (
        <>
          <div className={styles.listTools}>
            <p className={styles.small}>Open a row to see the case on one page. Copy its prompt to have an AI tool build the presentation.</p>
            <Button kind="ghost" size="sm" onClick={() => setOpened(all.every((id) => opened.has(id)) ? new Set() : new Set(all))}>
              {all.every((id) => opened.has(id)) ? 'Collapse all' : 'Expand all'}
            </Button>
          </div>
          <ul className={styles.list} aria-label="Case studies">
            {briefs.map((b) => (
              <Row key={b.projectId} id={`p-${b.projectId}`} name={b.projectName} outcome={b.outcome} prompt={b.prompt} open={opened.has(`p-${b.projectId}`)} onToggle={() => toggle(`p-${b.projectId}`)} onCopy={onCopy}>
                <BriefBody brief={b} />
              </Row>
            ))}
            {cases.map((c) => (
              <Row key={c.id} id={`c-${c.id}`} name={c.title} outcome={c.outcome} prompt={c.prompt} open={opened.has(`c-${c.id}`)} onToggle={() => toggle(`c-${c.id}`)} onCopy={onCopy}>
                <StudyBody study={c} onOpenTheme={onOpenTheme} />
              </Row>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
