import { Button, InlineNotification, Tag } from '@carbon/react'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { friendlyMessage, getDatabaseHealth, getHealth } from '../api/client'
import { SECTION_TITLES } from '../shell/nav'
import styles from './Placeholder.module.scss'

type Status = { kind: 'idle' } | { kind: 'ok'; text: string } | { kind: 'error'; text: string }

// Stand-in for every screen until its slice is built. Also proves the shell can reach the API.
export function Placeholder({ title }: { title?: string }) {
  const { section } = useParams()
  const heading = title ?? (section ? SECTION_TITLES[section] : undefined) ?? 'Signal Flow'
  const [api, setApi] = useState<Status>({ kind: 'idle' })
  const [db, setDb] = useState<Status>({ kind: 'idle' })

  useEffect(() => {
    getHealth()
      .then((h) => setApi({ kind: 'ok', text: `Running, version ${h.version}.` }))
      .catch((e) => setApi({ kind: 'error', text: friendlyMessage(e) }))
  }, [])

  // The database check is a button, not automatic, so opening a page never wakes a paused Neon compute.
  const checkDatabase = () =>
    getDatabaseHealth()
      .then((d) => setDb({ kind: 'ok', text: `Database reachable, ${d.migrations} migrations applied.` }))
      .catch((e) => setDb({ kind: 'error', text: friendlyMessage(e) }))

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{heading}</h1>
      <p className={styles.lede}>This screen is built in a later phase.</p>
      <Tag size="sm" type="gray">
        Not built yet
      </Tag>

      <div className={styles.status}>
        {api.kind === 'ok' && <InlineNotification kind="success" lowContrast hideCloseButton title="API" subtitle={api.text} />}
        {api.kind === 'error' && <InlineNotification kind="warning" lowContrast hideCloseButton title="API" subtitle={api.text} />}
        <Button kind="tertiary" size="sm" onClick={checkDatabase}>
          Check database
        </Button>
        {db.kind === 'ok' && <InlineNotification kind="success" lowContrast hideCloseButton title="Database" subtitle={db.text} />}
        {db.kind === 'error' && <InlineNotification kind="warning" lowContrast hideCloseButton title="Database" subtitle={db.text} />}
      </div>
    </div>
  )
}
