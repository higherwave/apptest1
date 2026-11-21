import { useEffect, useState } from 'react'
import { Button, InlineNotification, TextInput } from '@carbon/react'
import { friendlyMessage, type PulseWeights } from '../../api/client'
import { useMe, usePulseWeights, useSetPulseWeights } from '../../api/hooks'
import { CHANNELS } from '../pulse/channels'
import { PulseOpportunities } from './PulseOpportunities'
import { PulseSalesforce } from './PulseSalesforce'
import { PulseSources } from './PulseSources'
import { SettingsHeader } from './SettingsHeader'
import styles from './NotificationsPage.module.scss'

// Admin, Pulse (owners, while the preview is on): what a signal from each channel counts for in a topic's ranking. A change re-ranks the topics at once, because the score is
// worked out from the signals and these weights every time it is read. The designated feedback sources are listed below the weights.
export function PulseSettingsPage() {
  const me = useMe()
  const weights = usePulseWeights(!!me.data?.features.pulse)
  const save = useSetPulseWeights()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (weights.data) setDraft(Object.fromEntries(CHANNELS.map((c) => [c.key, String(weights.data.weights[c.key])])))
  }, [weights.data])

  if (me.data && !me.data.features.pulse) {
    return (
      <div className={styles.page}>
        <SettingsHeader />
        <p className={styles.text}>Pulse is not switched on for this workspace. Turn it on under Previews.</p>
      </div>
    )
  }
  const parsed = CHANNELS.map((c) => ({ key: c.key, n: draft[c.key] === undefined || draft[c.key].trim() === '' ? NaN : Number(draft[c.key]) }))
  const invalid = (n: number) => !Number.isFinite(n) || n < 0 || n > 5
  const bad = parsed.some((p) => invalid(p.n))
  const changed = weights.data && parsed.some((p) => p.n !== weights.data!.weights[p.key])
  const submit = async () => {
    setSaved(false)
    try {
      await save.mutateAsync(Object.fromEntries(parsed.map((p) => [p.key, p.n])) as Partial<PulseWeights>)
      setSaved(true)
    } catch {
      /* shown below */
    }
  }
  return (
    <div className={styles.page}>
      <SettingsHeader />
      <section className={styles.card} aria-label="Channel weights" data-testid="pulse-weights-card">
        <h2 className={styles.head}>What each channel counts for</h2>
        <p className={styles.text}>
          A topic's score is its signals added up, each multiplied by the weight of the channel it was heard in. Direct customer words weigh most by default. Changing a weight re-ranks the topics at once, and the Topics page shows the sums, so
          anyone can see why a topic ranks where it does. A weight is a number from 0 (ignore the channel) to 5.
        </p>
        {CHANNELS.map((c) => {
          const n = parsed.find((p) => p.key === c.key)!.n
          return (
            <TextInput
              key={c.key}
              id={`weight-${c.key}`}
              data-testid={`weight-${c.key}`}
              labelText={c.label}
              inputMode="decimal"
              value={draft[c.key] ?? ''}
              invalid={draft[c.key] !== undefined && invalid(n)}
              invalidText="Use a number from 0 to 5."
              onChange={(e) => {
                setSaved(false)
                setDraft({ ...draft, [c.key]: e.target.value })
              }}
            />
          )
        })}
        {save.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Not saved" subtitle={friendlyMessage(save.error)} />}
        {saved && <InlineNotification hideCloseButton lowContrast kind="success" title="Weights saved" subtitle="Topics are re-ranked." data-testid="weights-saved" />}
        <div>
          <Button kind="primary" size="md" data-testid="weights-save" disabled={!changed || bad || save.isPending} onClick={submit}>
            {save.isPending ? 'Saving…' : 'Save weights'}
          </Button>
        </div>
      </section>
      <PulseSources />
      <PulseSalesforce />
      <PulseOpportunities />
    </div>
  )
}
