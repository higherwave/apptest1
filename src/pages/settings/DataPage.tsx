import { useState } from 'react'
import { Download } from '@carbon/icons-react'
import { Button, InlineNotification } from '@carbon/react'
import { ApiRequestError, download } from '../../api/client'
import { SettingsHeader } from './SettingsHeader'
import { LegalHoldCard } from './LegalHoldCard'
import styles from './DataPage.module.scss'

const DOWNLOADS = [
  {
    key: 'workspace',
    path: '/export/workspace.zip',
    title: 'All of your data',
    note: 'Every project, transcript, theme, requirement, story and launch answer, as one ZIP: the complete record as JSON, plus readable files for each project. Slack and Jira connection details are left out.',
  },
  { key: 'audit', path: '/export/audit.csv', title: 'Audit log', note: 'What changed and who changed it, as a spreadsheet.' },
  { key: 'usage', path: '/export/ai-usage.csv', title: 'AI usage', note: 'Every AI call made for this workspace, with its cost and where it ran, as a spreadsheet.' },
] as const

// How long things are kept, in plain words. These are the defaults for every workspace.
const KEEP = [
  ['Projects, transcripts, themes, requirements, stories and launch answers', 'For the life of the workspace. They are how the system learns from one release to the next.'],
  ['Audit log, AI usage, notification and Slack post records', '12 months, then removed. Download them any time before that.'],
  ['Documents and PDFs', 'Not stored. They are made from your saved data whenever someone opens or exports one, so they are always current.'],
  ['Anything you delete', 'Held in My deleted items for 90 days so it can be restored, then removed for good. Owners can also delete now.'],
  ['Records of messages sent (email and Slack)', 'After 12 months only the fact that a message was sent is kept: no content, so nothing is ever sent twice.'],
  ['When you end your agreement', 'You can download everything first. We keep your data for 30 more days in case you need it, then remove it and confirm in writing.'],
] as const

// The Admin "Data" page (owners): taking your data away at any time, and how long each kind is kept.
export function DataPage() {
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<{ key: string; name: string } | null>(null)
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null)

  const run = async (key: string, path: string) => {
    setBusy(key)
    setDone(null)
    setFailed(null)
    try {
      setDone({ key, name: await download(path) })
    } catch (err) {
      setFailed({ key, message: err instanceof ApiRequestError ? err.message : 'The download did not start. Try again.' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={styles.page}>
      <SettingsHeader />
      <section className={styles.card} aria-label="Download your data" data-testid="data-downloads">
        <h2 className={styles.head}>Download your data</h2>
        <p className={styles.text}>Your data is yours. Take a copy at any time; each download is recorded in the audit log.</p>
        <ul className={styles.rows}>
          {DOWNLOADS.map((d) => (
            <li key={d.key} className={styles.row}>
              <div className={styles.what}>
                <p className={styles.title}>{d.title}</p>
                <p className={styles.note}>{d.note}</p>
              </div>
              <Button kind="tertiary" size="md" renderIcon={Download} data-testid={`download-${d.key}`} disabled={busy !== null} onClick={() => run(d.key, d.path)}>
                {busy === d.key ? 'Preparing…' : 'Download'}
              </Button>
            </li>
          ))}
        </ul>
        {done && <InlineNotification hideCloseButton lowContrast kind="success" title="Downloaded" subtitle={done.name} data-testid="download-done" />}
        {failed && <InlineNotification hideCloseButton lowContrast kind="error" title="The download failed" subtitle={failed.message} data-testid="download-failed" />}
      </section>
      <section className={styles.card} aria-label="How long things are kept" data-testid="data-keeping">
        <h2 className={styles.head}>How long things are kept</h2>
        <ul className={styles.rows}>
          {KEEP.map(([what, how]) => (
            <li key={what} className={styles.row}>
              <div className={styles.what}>
                <p className={styles.title}>{what}</p>
                <p className={styles.note}>{how}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <LegalHoldCard />
    </div>
  )
}
