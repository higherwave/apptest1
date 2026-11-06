import { ChevronLeft, ChevronRight, Download } from '@carbon/icons-react'
import { Button, InlineNotification, Loading, Modal } from '@carbon/react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ProjectDetail, Storyboard } from '../../api/client'
import { useStrip } from '../../components/useStrip'
import { ProjectHeader } from '../project/ProjectHeader'
import { ScaledSlide, Slide, type Deck, type SlideNumber } from './Slides'
import { SLIDE_COUNT, SLIDE_TITLES } from './storyboardText'
import styles from './StoryboardView.module.scss'

export type StoryboardViewProps = {
  /** `ungenerated`: the project has themes but nobody has written the deck's text yet. */
  state: 'loading' | 'error' | 'empty' | 'ungenerated' | 'ready'
  project?: ProjectDetail
  board?: Storyboard
  /** Who the deck is from: the signed-in person. */
  author: string
  canEdit: boolean
  generating: boolean
  errorText?: string
  /** Set when the last generate saved the plain draft because the AI budget or credit was used up. */
  fallback?: Storyboard['fallback']
  onGenerate: () => void
  onGoTranscripts: () => void
  onAllThemes: () => void
}

const SLIDES: SlideNumber[] = [1, 2, 3, 4, 5, 6]

// A style that sizes the PDF's pages to the slides (10 by 5.625 inches, 16:9). It is added only while printing, since @page cannot be scoped to a screen.
const PAGE_RULE = '@page { size: 10in 5.625in; margin: 0 }'

// Presentational: the project's research as a deck. Nobody edits it here; it is read, and downloaded to be changed in another tool.
export function StoryboardView({ state, project, board, author, canEdit, generating, errorText, fallback, onGenerate, onGoTranscripts, onAllThemes }: StoryboardViewProps) {
  const [current, setCurrent] = useState<SlideNumber>(1)
  const [again, setAgain] = useState(false)
  const deck: Deck | null = board?.draft ? { facts: board.facts, draft: board.draft } : null
  const strip = useStrip(SLIDE_COUNT, board?.draft?.generatedAt)

  // While this page is up, printing shows only the deck (see StoryboardView.module.scss).
  useEffect(() => {
    document.body.setAttribute('data-storyboard-print', '')
    return () => document.body.removeAttribute('data-storyboard-print')
  }, [])

  const download = () => {
    const rule = document.createElement('style')
    rule.textContent = PAGE_RULE
    document.head.appendChild(rule)
    const title = document.title
    if (board) document.title = `${board.facts.projectName} storyboard`
    const done = () => {
      rule.remove()
      document.title = title
      window.removeEventListener('afterprint', done)
    }
    window.addEventListener('afterprint', done)
    window.print()
  }

  const go = (n: number) => setCurrent(Math.min(SLIDE_COUNT, Math.max(1, n)) as SlideNumber)
  const all = strip.view.first === 1 && strip.view.last === SLIDE_COUNT

  return (
    <div className={styles.page}>
      {project && (
        <ProjectHeader
          title="Storyboard"
          description="Your research as a short deck to share with product leaders. The solutions and trade-offs are best guesses to react to."
          actions={
            deck && (
              <>
                {canEdit && (
                  <Button kind="tertiary" size="md" disabled={generating} onClick={() => setAgain(true)}>
                    {generating ? 'Writing…' : 'Regenerate'}
                  </Button>
                )}
                <Button kind="primary" size="md" renderIcon={Download} onClick={download}>
                  Download as PDF
                </Button>
              </>
            )
          }
        />
      )}

      {state === 'loading' && <Loading small withOverlay={false} description="Loading the storyboard" />}
      {state === 'error' && <InlineNotification kind="warning" lowContrast hideCloseButton title="Storyboard" subtitle={errorText} />}
      {state === 'empty' && (
        <div className={styles.empty}>
          <p>No themes yet. Add transcripts and run the analysis to find them, and the storyboard is written from them.</p>
          <Button kind="secondary" onClick={onGoTranscripts}>
            Go to Transcripts
          </Button>
        </div>
      )}
      {state === 'ungenerated' && (
        <div className={styles.empty}>
          {canEdit ? (
            <>
              <p>The storyboard has not been written yet. It tells the problem, what people said, the recommended solutions and their trade-offs from this project’s themes. The solutions and trade-offs are an AI’s best guess.</p>
              <Button kind="primary" disabled={generating} onClick={onGenerate}>
                {generating ? 'Writing the storyboard…' : 'Generate the storyboard'}
              </Button>
            </>
          ) : (
            <p>The storyboard has not been written yet. An owner or editor can generate it from this project’s themes.</p>
          )}
        </div>
      )}
      {errorText && (state === 'ungenerated' || state === 'ready') && <InlineNotification kind="warning" lowContrast hideCloseButton title="Storyboard" subtitle={errorText} />}
      {fallback && <InlineNotification kind="info" lowContrast hideCloseButton title="Plain draft" subtitle={`The AI ${fallback === 'budget' ? 'budget for this month is used up' : 'credit is used up'}, so this draft was made without the AI model. Generate it again once that is sorted out.`} />}
      {state === 'ready' && board?.draft?.source === 'template' && !fallback && (
        <InlineNotification kind="info" lowContrast hideCloseButton title="Plain draft" subtitle="This draft was made without the AI model, so the costs, risks and trade-offs are not estimated. Generate it again with the AI model on to fill them in." />
      )}

      {state === 'ready' && deck && (
        <>
          <section className={styles.strip} aria-label="Slides">
            <div className={styles.stripHead}>
              {!all && (
                <div className={styles.controls}>
                  <Button kind="ghost" size="sm" hasIconOnly renderIcon={ChevronLeft} iconDescription="Previous slides" tooltipPosition="bottom" disabled={!strip.view.canBack} onClick={() => strip.move(-1)} />
                  <Button kind="ghost" size="sm" hasIconOnly renderIcon={ChevronRight} iconDescription="Next slides" tooltipPosition="bottom" disabled={!strip.view.canForward} onClick={() => strip.move(1)} />
                </div>
              )}
            </div>
            <ul ref={strip.track} className={styles.track} onScroll={strip.measure} aria-label="Slides">
              {SLIDES.map((n) => (
                <li key={n} className={styles.item}>
                  <Button kind="ghost" size="sm" className={styles.thumb} data-current={current === n} aria-current={current === n ? 'true' : undefined} aria-label={`Slide ${n}: ${SLIDE_TITLES[n - 1]}`} onClick={() => go(n)}>
                    <ScaledSlide thumb n={n} deck={deck} author={author} />
                    <span className={styles.thumbNumber}>{n}</span>
                  </Button>
                </li>
              ))}
            </ul>
          </section>

          <div className={styles.stage}>
            <div className={styles.slide} role="group" aria-roledescription="slide" aria-label={`Slide ${current} of ${SLIDE_COUNT}: ${SLIDE_TITLES[current - 1]}`}>
              <ScaledSlide n={current} deck={deck} author={author} onAllThemes={onAllThemes} />
            </div>
            <div className={styles.caption}>
              <p className={styles.captionText} role="status">
                Slide {current} of {SLIDE_COUNT} · {SLIDE_TITLES[current - 1]}
              </p>
              <div className={styles.controls}>
                <Button kind="ghost" size="sm" hasIconOnly renderIcon={ChevronLeft} iconDescription="Previous slide" tooltipPosition="top" disabled={current === 1} onClick={() => go(current - 1)} />
                <Button kind="ghost" size="sm" hasIconOnly renderIcon={ChevronRight} iconDescription="Next slide" tooltipPosition="top" disabled={current === SLIDE_COUNT} onClick={() => go(current + 1)} />
              </div>
            </div>
          </div>

          {createPortal(
            <div className={styles.print} data-testid="storyboard-print">
              {SLIDES.map((n) => (
                <div key={n} className={styles.sheet}>
                  <Slide n={n} deck={deck} author={author} />
                </div>
              ))}
            </div>,
            document.body,
          )}
        </>
      )}

      <Modal
        open={again}
        size="sm"
        modalHeading="Write the storyboard again?"
        primaryButtonText="Regenerate"
        secondaryButtonText="Cancel"
        onRequestClose={() => setAgain(false)}
        onRequestSubmit={() => {
          setAgain(false)
          onGenerate()
        }}
      >
        <p className={styles.confirm}>The headline, problem, solutions, trade-offs and recommendation are written again from the project’s themes and replace the current text for everyone. The figures and quotes always come straight from the project.</p>
      </Modal>
    </div>
  )
}
