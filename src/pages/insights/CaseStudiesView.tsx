import { Button, Dropdown, InlineNotification, Loading, Tag, TextArea, Tile } from '@carbon/react'
import { useState } from 'react'
import type { CaseBrief, CaseStudy, InsightsThemes } from '../../api/client'
import { InsightsHeader } from './InsightsHeader'
import styles from './CaseStudiesView.module.scss'

export type CaseStudiesViewProps = {
  state: 'loading' | 'error' | 'empty' | 'ready'
  cases: CaseStudy[]
  errorText?: string
  /** The analysed projects a brief can be made from. */
  projects: InsightsThemes['projects']
  projectId: string | null
  brief?: CaseBrief
  briefLoading: boolean
  briefFailed: boolean
  onPickProject: (id: string | null) => void
  /** Puts text on the clipboard; false when the browser would not. */
  onCopy: (text: string) => Promise<boolean>
  onOpenTheme: (id: string) => void
}

// "Sep 2026" from a YYYY-MM-DD date; the day is not meaningful.
const monthYear = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '')
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const RESULT = { worked: 'Worked', needs_attention: 'Needs attention', too_early: 'Too early to tell' } as const

// A button that puts a prompt on the clipboard and says so; if the browser refuses, the prompt is shown to copy by hand.
function CopyPrompt({ prompt, label, onCopy, id }: { prompt: string; label: string; onCopy: CaseStudiesViewProps['onCopy']; id: string }) {
  const [done, setDone] = useState<'copied' | 'failed' | null>(null)
  return (
    <div className={styles.copy}>
      <Button
        kind="secondary"
        size="sm"
        onClick={async () => {
          setDone((await onCopy(prompt)) ? 'copied' : 'failed')
        }}
      >
        {label}
      </Button>
      <span className={styles.copyNote} role="status">
        {done === 'copied' && 'Copied. Paste it into Claude Design or another AI tool.'}
      </span>
      {done === 'failed' && <TextArea id={id} labelText="Select and copy this prompt" rows={8} readOnly value={prompt} />}
    </div>
  )
}

// The brief for one project, as a quick view: five short sections and the prompt that turns them into a presentation.
function Brief({ brief, onCopy }: { brief: CaseBrief; onCopy: CaseStudiesViewProps['onCopy'] }) {
  return (
    <div className={styles.brief} data-testid="case-brief">
      <div className={styles.briefGrid}>
        <section aria-label="The problem" className={styles.briefSection}>
          <h3 className={styles.label}>The problem</h3>
          <p className={styles.small}>{brief.template ?? 'Research study'} · {plural(brief.sessions, 'session')} · {plural(brief.participants, 'participant')}</p>
          {brief.problem.length === 0 && <p className={styles.small}>No themes yet. Analyze the project’s transcripts first.</p>}
          {brief.problem.map((t) => (
            <p key={t.title} className={styles.item}>
              {t.title} <span className={styles.small}>· {t.participantCount} of {t.totalParticipants} participants</span>
            </p>
          ))}
        </section>
        <section aria-label="What people said" className={styles.briefSection}>
          <h3 className={styles.label}>What people said</h3>
          {brief.evidence.map((q) => (
            <blockquote key={q.text} className={styles.quote}>
              <p className={styles.quoteText}>“{q.text}”</p>
              <p className={styles.quoteMeta}>{q.speaker} · on “{q.themeTitle}”</p>
            </blockquote>
          ))}
        </section>
        <section aria-label="What we decided" className={styles.briefSection}>
          <h3 className={styles.label}>What we decided</h3>
          {!brief.decisions && <p className={styles.small}>Nothing yet: the requirements are not published.</p>}
          {brief.decisions?.requirements.map((r) => (
            <p key={r.key} className={styles.item}>
              <strong>{r.key}</strong> {r.title} <span className={styles.small}>· {r.priority} priority</span>
            </p>
          ))}
          {brief.decisions?.alternatives.map((a) => (
            <p key={a.title} className={styles.small}>Considered and rejected: {a.title}</p>
          ))}
        </section>
        <section aria-label="What we designed" className={styles.briefSection}>
          <h3 className={styles.label}>What we designed</h3>
          {brief.designs.length === 0 && <p className={styles.small}>No prototypes or design notes yet.</p>}
          {brief.designs.map((d) => (
            <p key={d.key} className={styles.item}>
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
        <section aria-label="What happened" className={styles.briefSection}>
          <h3 className={styles.label}>What happened</h3>
          {(!brief.results || brief.results.items.length === 0) && <p className={styles.small}>Nothing has been measured yet.</p>}
          {brief.results?.items.map((r) => (
            <div key={r.key} className={styles.item}>
              <p className={styles.item}>
                <strong>{r.key}</strong> {r.metric ?? r.title}
              </p>
              <p className={styles.small}>
                {r.baseline ? `Before ${r.baseline}` : ''}
                {r.baseline && r.target ? ' · ' : ''}
                {r.target ? `Goal ${r.target}` : ''}
                {r.latest ? ` · Latest (${r.latest.on}): ${r.latest.value}` : ''}
              </p>
              <Tag size="sm" type={r.result === 'worked' ? 'green' : r.result === 'needs_attention' ? 'red' : r.result ? 'gray' : 'outline'}>
                {r.result ? RESULT[r.result as keyof typeof RESULT] : 'Not measured yet'}
              </Tag>
            </div>
          ))}
        </section>
      </div>
      <CopyPrompt prompt={brief.prompt} label="Copy prompt for an AI tool" onCopy={onCopy} id={`brief-prompt-${brief.projectId}`} />
    </div>
  )
}

// Presentational: start a case study from a project, and what the team shipped from research, each tied back to the themes it came from.
export function CaseStudiesView({ state, cases, errorText, projects, projectId, brief, briefLoading, briefFailed, onPickProject, onCopy, onOpenTheme }: CaseStudiesViewProps) {
  const picked = projects.find((p) => p.id === projectId)
  return (
    <div className={styles.page}>
      <InsightsHeader title="Case Studies" description="What the team changed because of what it learned" />
      {errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Something went wrong" subtitle={errorText} />}

      {projects.length > 0 && (
        <section className={styles.start} aria-label="Start a case study">
          <h2 className={styles.label}>Start a case study from a project</h2>
          <p className={styles.small}>Pick a project to see its problem, evidence, decisions, designs and results on one page, then copy a prompt that asks an AI tool such as Claude Design to build the presentation.</p>
          <Dropdown
            id="case-brief-project"
            titleText="Project"
            label="Choose a project"
            items={projects}
            itemToString={(p) => p?.name ?? ''}
            selectedItem={picked ?? null}
            onChange={({ selectedItem }) => onPickProject(selectedItem?.id ?? null)}
          />
          {briefLoading && <Loading small withOverlay={false} description="Loading the brief" />}
          {briefFailed && <p className={styles.small}>The brief could not be loaded.</p>}
          {brief && brief.projectId === projectId && <Brief brief={brief} onCopy={onCopy} />}
        </section>
      )}

      {state === 'loading' && <Loading withOverlay={false} description="Loading case studies" />}
      {state === 'empty' && <p className={styles.empty}>No case studies yet.</p>}
      {state === 'ready' && (
        <>
          <h2 className={styles.label}>Case studies</h2>
          <div className={styles.grid}>
            {cases.map((c) => (
              <Tile key={c.id} className={styles.card} data-tint={c.color} data-testid="case-study">
                <div className={styles.top}>
                  <span>{c.ownerTeam}</span>
                  <span>{monthYear(c.date)}</span>
                </div>
                <h2 className={styles.title}>{c.title}</h2>
                <p className={styles.summary}>{c.summary}</p>
                <p className={styles.outcome}>{c.outcome}</p>
                {c.quotes.map((q) => (
                  <blockquote key={q.id} className={styles.quote}>
                    <p className={styles.quoteText}>“{q.text}”</p>
                    <p className={styles.quoteMeta}>{q.speaker} · {q.session}</p>
                  </blockquote>
                ))}
                <div className={styles.based}>
                  <p className={styles.label}>
                    Based on
                    {c.opportunities > 0 && (
                      <Tag size="sm" type="purple" className={styles.oppTag}>
                        {plural(c.opportunities, 'opportunity', 'opportunities')} still open
                      </Tag>
                    )}
                  </p>
                  <div className={styles.themes}>
                    {c.themes.map((t) => (
                      <Button key={t.id} kind="tertiary" size="sm" onClick={() => onOpenTheme(t.id)}>
                        {t.title}
                      </Button>
                    ))}
                  </div>
                </div>
                <CopyPrompt prompt={c.prompt} label="Copy prompt for an AI tool" onCopy={onCopy} id={`case-prompt-${c.id}`} />
              </Tile>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
