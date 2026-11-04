import { ProgressBar, Tag } from '@carbon/react'
import { useAiStatus, useMe } from '../../api/hooks'
import { SettingsHeader } from './SettingsHeader'
import styles from './AppStatusPage.module.scss'

const PURPOSE_LABEL: Record<string, string> = { analysis: 'Transcript analysis', spec_step: 'Requirements drafting', theme_match: 'Theme matching' }
const SPEND_LABEL = { half: '50% reached', high: '80% reached', reached: 'Budget reached' } as const

// How the app is running: this month's AI spend against its budget, and the recent problems the AI steps ran into. Owners only: the
// Settings gate sends everyone else away, and the server sends these figures to owners alone.
export function AppStatusPage() {
  const me = useMe()
  const ai = useAiStatus()
  const owner = me.data?.role === 'owner'
  const pct = (spent: number, budget: number) => Math.round((spent / Math.max(budget, 0.01)) * 100)
  return (
    <div className={styles.page}>
      <SettingsHeader />
      {owner && ai.isSuccess && (
        <>
          <section className={styles.card} aria-label="AI mode">
            <h2 className={styles.head}>AI</h2>
            <p className={styles.text}>
              <Tag size="sm" type={ai.data.mode === 'live' ? 'blue' : 'gray'}>
                {ai.data.mode === 'live' ? 'AI: live' : 'AI: simulated'}
              </Tag>{' '}
              {ai.data.mode === 'live' ? 'Analysis, theme matching and requirements drafting run on the live model.' : 'The steps run on the built-in simulation, not a live model.'}
            </p>
          </section>
          {ai.data.budgetUsd !== undefined && (
            <section className={styles.card} aria-label="AI spend this month">
              <h2 className={styles.head}>
                Spend this month{ai.data.month ? ` (${ai.data.month})` : ''}{' '}
                {ai.data.spendLevel && ai.data.spendLevel !== 'ok' && (
                  <Tag size="sm" type={ai.data.spendLevel === 'half' ? 'warm-gray' : 'red'}>
                    {SPEND_LABEL[ai.data.spendLevel]}
                  </Tag>
                )}
              </h2>
              <ProgressBar
                label="AI spend against the monthly budget"
                hideLabel
                size="small"
                value={Math.min(ai.data.spentUsd ?? 0, ai.data.budgetUsd)}
                max={Math.max(ai.data.budgetUsd, 0.01)}
                helperText={`$${(ai.data.spentUsd ?? 0).toFixed(2)} of $${ai.data.budgetUsd.toFixed(2)} (${pct(ai.data.spentUsd ?? 0, ai.data.budgetUsd)}%)`}
              />
              <p className={styles.text}>Alerts appear at 50%, 80% and 100% of the budget. At 100% AI steps use the simulation until next month or a higher AI_MONTHLY_BUDGET_USD.</p>
            </section>
          )}
          <section className={styles.card} aria-label="Recent problems">
            <h2 className={styles.head}>Recent problems</h2>
            {ai.data.problems?.length ? (
              <ul className={styles.problems}>
                {ai.data.problems.map((p) => (
                  <li key={`${p.at}-${p.code}`} className={styles.problem}>
                    <p className={styles.meta}>
                      {new Date(p.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {PURPOSE_LABEL[p.purpose] ?? p.purpose}
                    </p>
                    <p className={styles.problemText}>{p.message}</p>
                    {p.detail && <p className={styles.meta}>{p.detail}</p>}
                    <p className={styles.meta}>{p.code}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.text}>No problems in the past 30 days.</p>
            )}
            <p className={styles.meta}>Problems: the last 10 from the past 30 days. Nothing from the research is stored with them.</p>
          </section>
        </>
      )}
    </div>
  )
}
