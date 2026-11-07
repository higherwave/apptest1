import { ArrowRight } from '@carbon/icons-react'
import { Button } from '@carbon/react'
import { useEffect, useRef } from 'react'
import type { Storyboard } from '../../api/client'
import { CategoryBadge } from '../themes/CategoryBadge'
import { clip, dateRange, draftLabel, heardTitle, longDate, slidePlan, slideTitle, THEMES_ON_SLIDE } from './storyboardText'
import styles from './Slides.module.scss'

/** A storyboard whose text has been written. */
export type Deck = { facts: Storyboard['facts']; draft: NonNullable<Storyboard['draft']> }

/** A tile on "What we heard" fits about this much of a quote. */
const QUOTE_CHARS = 110

const TRADE_OFF_COLUMNS = ['Benefit', 'Cost', 'Risk', 'What we give up', 'Alternatives considered'] as const

function DraftLabel({ source }: { source: 'model' | 'template' }) {
  return <p className={styles.draftLabel}>{draftLabel(source)}</p>
}

function Band({ n, name, title, children }: { n: number; name: string; title: string; children?: React.ReactNode }) {
  return (
    <header className={styles.band}>
      <div>
        <p className={styles.eyebrow}>
          {n} · {name}
        </p>
        <h2 className={styles.bandTitle}>{title}</h2>
      </div>
      {children}
    </header>
  )
}

// One slide, laid out on a fixed 60 by 33.75 rem canvas (16:9). Where it shows is the caller's business: ScaledSlide fits it to a width, and the
// print layout uses it as it is. `onAllThemes` adds the "Show all themes" link, which only makes sense on screen.
export function Slide({ n, deck, author, onAllThemes }: { n: number; deck: Deck; author: string; onAllThemes?: () => void }) {
  const { facts, draft } = deck
  const plan = slidePlan(draft.solutions)
  const spec = plan[n - 1] ?? plan[0]
  const name = slideTitle(spec)
  const shown = facts.themes.slice(0, THEMES_ON_SLIDE)
  const titleOf = (id: string) => facts.themes.find((t) => t.id === id)?.title

  if (spec.kind === 'title') {
    return (
      <section className={styles.slide} data-dark="true">
        <div className={styles.titleTop}>
          <p className={styles.titleKicker}>{facts.projectName} · Research storyboard</p>
          <span className={styles.status}>Draft for review</span>
        </div>
        <h2 className={styles.titleMain}>{draft.headline}</h2>
        <div className={styles.titleFoot}>
          <span>{longDate(draft.generatedAt)}</span>
          {author && <span>{author}</span>}
        </div>
      </section>
    )
  }

  if (spec.kind === 'problem') {
    return (
      <section className={styles.slide}>
        <Band n={n} name={name} title={draft.problem} />
        <div className={styles.problemBody}>
          <div className={styles.problemLeft}>
            <div className={styles.stats}>
              <div>
                <p className={styles.statNumber}>{facts.participants}</p>
                <p className={styles.statLabel}>{facts.participants === 1 ? 'participant' : 'participants'}</p>
              </div>
              <div>
                <p className={styles.statNumber}>{facts.sessions}</p>
                <p className={styles.statLabel}>{facts.sessions === 1 ? 'session' : 'sessions'}</p>
              </div>
            </div>
            {facts.roles.length > 0 && (
              <div>
                <h3 className={styles.heading}>Who we tested with</h3>
                <ul className={styles.plain}>
                  {facts.roles.map((r) => (
                    <li key={r.role}>
                      {r.role} ({r.count})
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className={styles.problemRight}>
            {facts.tasks.length > 0 && (
              <div>
                <h3 className={styles.heading}>Tasks we observed</h3>
                <ul className={styles.plain}>
                  {facts.tasks.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
            {facts.when && (
              <div>
                <h3 className={styles.heading}>When</h3>
                <p className={styles.text}>{dateRange(facts.when.from, facts.when.to)}</p>
              </div>
            )}
          </div>
        </div>
      </section>
    )
  }

  if (spec.kind === 'heard') {
    return (
      <section className={styles.slide}>
        <Band n={n} name={name} title={heardTitle(shown.length, facts.participants)}>
          {onAllThemes && facts.themeCount > shown.length && (
            <Button kind="ghost" size="sm" className={styles.bandLink} renderIcon={ArrowRight} onClick={onAllThemes}>
              Show all themes ({facts.themeCount})
            </Button>
          )}
        </Band>
        <ul className={styles.themes} data-count={shown.length}>
          {shown.map((t) => (
            <li key={t.id} className={styles.theme}>
              <p className={styles.themeCount}>
                {t.participants} <span>of {t.totalParticipants}</span>
              </p>
              <CategoryBadge category={t.category as Parameters<typeof CategoryBadge>[0]['category']} quiet />
              <p className={styles.themeName}>{t.title}</p>
              {t.quote && (
                <blockquote className={styles.quote}>
                  “{clip(t.quote.text, QUOTE_CHARS)}”<cite>{t.quote.who}</cite>
                </blockquote>
              )}
            </li>
          ))}
        </ul>
      </section>
    )
  }

  if (spec.kind === 'solutions') {
    return (
      <section className={styles.slide}>
        <Band n={n} name={name} title={draft.solutions.length === 1 ? 'One solution addresses the themes' : `${draft.solutions.length} solutions address the themes`}>
          <DraftLabel source={draft.source} />
        </Band>
        <ol className={styles.solutions} data-count={draft.solutions.length}>
          {draft.solutions.map((s, i) => (
            <li key={s.name} className={styles.solution}>
              <p className={styles.solutionNum}>Solution {i + 1}</p>
              <h3 className={styles.solutionName}>{s.name}</h3>
              <p className={styles.text}>{s.description}</p>
              {s.themes.length > 0 && (
                <div>
                  <p className={styles.heading}>Addresses these themes</p>
                  <ul className={styles.chips}>
                    {s.themes.map((t) => (
                      <li key={t.id} className={styles.chip}>
                        {titleOf(t.id) ?? t.title}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>
    )
  }

  if (spec.kind === 'tradeoffs') {
    return (
      <section className={styles.slide}>
        <Band n={n} name={name} title={(spec.part ?? 1) > 1 ? `Cost and risk, continued (${spec.part} of ${spec.parts})` : spec.parts && spec.parts > 1 ? `Cost and risk differ across the solutions (1 of ${spec.parts})` : 'Cost and risk differ across the solutions'}>
          <DraftLabel source={draft.source} />
        </Band>
        <div role="table" aria-label="Trade-offs by solution" className={styles.table}>
          <div role="row" className={styles.row}>
            <div role="columnheader" className={styles.th}>Solution</div>
            {TRADE_OFF_COLUMNS.map((c) => (
              <div key={c} role="columnheader" className={styles.th}>
                {c}
              </div>
            ))}
          </div>
          {(spec.rows ?? []).map((i) => draft.solutions[i]).map((s) => (
            <div key={s.name} role="row" className={styles.row}>
              <div role="rowheader" className={styles.rowHead}>{s.name}</div>
              {[s.benefit, s.cost, s.risk, s.giveUp, s.alternatives].map((v, i) => (
                <div key={TRADE_OFF_COLUMNS[i]} role="cell" className={styles.td}>
                  {v}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    )
  }

  return (
    <section className={styles.slide} data-dark="true">
      <div className={styles.closeTop}>
        <p className={styles.titleKicker}>
          {n} · {name}
        </p>
        <DraftLabel source={draft.source} />
      </div>
      <p className={styles.direction}>{draft.recommendation.direction}</p>
      <div className={styles.ask}>
        <div>
          <h3 className={styles.askHeading}>The decision we need</h3>
          <p className={styles.askText}>{draft.recommendation.decision}</p>
        </div>
        <div>
          <h3 className={styles.askHeading}>Next step</h3>
          <p className={styles.askText}>{draft.recommendation.nextStep}</p>
        </div>
      </div>
    </section>
  )
}

// A slide shrunk or stretched to the width it is given (its parent's), keeping 16:9. The slide is drawn at its own size and scaled, so type and spacing
// stay in proportion; `thumb` makes it a picture only (not focusable, hidden from screen readers).
export function ScaledSlide({ thumb = false, ...slide }: { n: number; deck: Deck; author: string; onAllThemes?: () => void; thumb?: boolean }) {
  const frame = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = frame.current
    if (!el) return
    // Set on the element itself: the scale is a measurement, not a style the page authors.
    const fit = () => {
      const c = canvas.current
      if (c && c.offsetWidth > 0) c.style.transform = `scale(${el.clientWidth / c.offsetWidth})`
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={frame} className={styles.frame} aria-hidden={thumb || undefined} {...(thumb ? { inert: true } : {})}>
      <div ref={canvas} className={styles.canvas}>
        <Slide {...slide} onAllThemes={thumb ? undefined : slide.onAllThemes} />
      </div>
    </div>
  )
}
