import { Button, Checkbox, Dropdown, InlineNotification, Loading, Modal } from '@carbon/react'
import { useState } from 'react'
import type { LaunchDetail, LaunchDigest, LaunchDigestShared } from '../../api/client'
import { momentText } from './launchText'
import styles from './FollowPanel.module.scss'

export type FollowPanelProps = {
  launch: LaunchDetail
  busy: boolean
  onAdd: (userIds: string[]) => Promise<boolean>
  onRemove: (userId: string) => void
  /** Builds the digest as it stands now; null when the call failed. */
  onPreview: () => Promise<LaunchDigest | null>
  onShare: (via: { email: boolean; slack: boolean }) => Promise<LaunchDigestShared | null>
}

const SLACK_RESULT: Record<LaunchDigestShared['slack'], string> = {
  posted: 'Posted in the Slack thread.',
  not_posted: 'Not posted to Slack: the team has no channel, or Slack refused it.',
  off: 'Not posted to Slack: Slack is not connected.',
  skipped: '',
}

// Following a launch from the research stage: who follows, and the early digest shared with them. A follower gets the digest and the plain-language brief,
// never the research itself, so what they read is exactly what the preview shows.
export function FollowPanel(p: FollowPanelProps) {
  const { launch } = p
  const [pick, setPick] = useState<{ userId: string; name: string } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [digest, setDigest] = useState<LaunchDigest | null>(null)
  const [email, setEmail] = useState(true)
  const [slack, setSlack] = useState(true)
  const [result, setResult] = useState<LaunchDigestShared | null>(null)
  const can = launch.you.canSetUp
  const { followers, candidates, lastShared } = launch.follow
  const hasSlack = !!launch.slack.channel
  // The people who answer steps are the natural followers: offer them in one go.
  const reviewerIds = [...new Set(launch.steps.filter((s) => s.used).flatMap((s) => [...s.reviewers.primary, ...s.reviewers.alternate].map((r) => r.userId)))]
  const reviewersToAdd = candidates.filter((c) => reviewerIds.includes(c.userId))
  const sending = (email && followers.length > 0) || (slack && hasSlack)

  const openPreview = async () => {
    setResult(null)
    setDigest(null)
    setPreviewing(true)
    setDigest(await p.onPreview())
  }

  return (
    <div className={styles.panel} data-testid="follow-panel">
      <div className={styles.block}>
        <p className={styles.eyebrow}>Following</p>
        <p className={styles.note}>
          People who follow this launch from the research stage get an early digest and the plain-language brief, so they understand the product by the time they are asked. They never see the research itself.
        </p>
        {followers.length === 0 ? (
          <p className={styles.note} data-testid="no-followers">Nobody follows yet.</p>
        ) : (
          <ul className={styles.people} aria-label="Followers" data-testid="followers">
            {followers.map((f) => (
              <li key={f.userId} className={styles.person}>
                <span>{f.name}</span>
                {can && <Button kind="ghost" size="sm" disabled={p.busy} onClick={() => p.onRemove(f.userId)} data-testid={`unfollow-${f.userId}`}>Remove</Button>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {can && (
        <div className={styles.block}>
          <Dropdown
            id="follow-pick"
            titleText="Add a follower"
            label="Choose a person"
            size="md"
            items={candidates}
            itemToString={(c) => c?.name ?? ''}
            selectedItem={pick}
            onChange={({ selectedItem }) => setPick(selectedItem ?? null)}
          />
          <div className={styles.actions}>
            <Button kind="secondary" size="sm" disabled={!pick || p.busy} data-testid="follow-add" onClick={async () => { if (pick && (await p.onAdd([pick.userId]))) setPick(null) }}>Add</Button>
            {reviewersToAdd.length > 0 && (
              <Button kind="tertiary" size="sm" disabled={p.busy} data-testid="follow-add-reviewers" onClick={() => void p.onAdd(reviewersToAdd.map((r) => r.userId))}>
                Add the {reviewersToAdd.length === 1 ? 'reviewer' : `${reviewersToAdd.length} reviewers`}
              </Button>
            )}
          </div>
        </div>
      )}

      <div className={styles.block}>
        <p className={styles.eyebrow}>Early digest</p>
        {lastShared ? (
          <p className={styles.note} data-testid="last-shared">
            Last shared {momentText(lastShared.at)}{lastShared.by ? ` by ${lastShared.by}` : ''}: {lastShared.emailed} {lastShared.emailed === 1 ? 'email' : 'emails'}{lastShared.inSlack ? ', and in the Slack thread' : ''}.
          </p>
        ) : (
          <p className={styles.note}>Not shared yet.</p>
        )}
        {result && (
          <InlineNotification
            kind="success"
            lowContrast
            title="Digest shared"
            subtitle={[
              result.followers > 0 || result.emailed > 0 ? `${result.emailed} of ${result.followers} followers emailed.` : '',
              result.held ? `${result.held} kept back by the temporary recipient limit.` : '',
              result.failed ? `${result.failed} failed.` : '',
              SLACK_RESULT[result.slack],
            ].filter(Boolean).join(' ')}
            onCloseButtonClick={() => setResult(null)}
            data-testid="digest-result"
          />
        )}
        {can ? (
          <div className={styles.actions}>
            <Button kind="primary" size="sm" disabled={p.busy} onClick={() => void openPreview()} data-testid="preview-digest">Preview and share</Button>
          </div>
        ) : (
          <p className={styles.note}>An editor of the project’s team shares it.</p>
        )}
      </div>

      <Modal
        open={previewing}
        size="md"
        modalHeading="Share the early digest"
        primaryButtonText={p.busy ? 'Sharing…' : 'Share'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={!digest || !sending || p.busy}
        onRequestClose={() => setPreviewing(false)}
        onRequestSubmit={async () => {
          const r = await p.onShare({ email: email && followers.length > 0, slack: slack && hasSlack })
          setPreviewing(false)
          if (r) setResult(r)
        }}
      >
        <div className={styles.modal} data-testid="digest-dialog">
          {!digest ? <Loading description="Building the digest" withOverlay={false} small /> : <p className={styles.preview} data-testid="digest-preview">{digest.text}</p>}
          <div className={styles.choices}>
            <Checkbox id="digest-email" labelText={followers.length ? `Email ${followers.length} ${followers.length === 1 ? 'follower' : 'followers'}` : 'Email followers (nobody follows yet)'} checked={email && followers.length > 0} disabled={followers.length === 0} onChange={(_, { checked }) => setEmail(checked)} />
            <Checkbox id="digest-slack" labelText={hasSlack ? `Post in the Slack thread (#${launch.slack.channel})` : 'Post in the Slack thread (this team has no channel)'} checked={slack && hasSlack} disabled={!hasSlack} onChange={(_, { checked }) => setSlack(checked)} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
