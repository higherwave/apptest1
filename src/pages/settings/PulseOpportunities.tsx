import { useState } from 'react'
import { Button, InlineNotification, Select, SelectItem, TextInput } from '@carbon/react'
import { friendlyMessage } from '../../api/client'
import { useAddPulseOpportunitySource, usePulseSources } from '../../api/hooks'
import styles from './PulseSources.module.scss'

const SCOPES = [
  { key: 'both', label: 'Open, and lost in the last 90 days' },
  { key: 'open', label: 'Open opportunities only' },
  { key: 'lost', label: 'Lost in the last 90 days only' },
] as const
const MODES = [
  { key: 'review', label: 'Wait for review' },
  { key: 'keep', label: 'Count at once' },
] as const

// Admin, Pulse: the notes on Salesforce opportunities as a source. The owner names the fields (their API names) and which opportunities; only those fields are read. The source then
// appears in "Where Pulse listens" with the rest, where it is checked, switched off or removed.
export function PulseOpportunities() {
  const sources = usePulseSources()
  const add = useAddPulseOpportunitySource()
  const [fields, setFields] = useState('NextStep, Description')
  const [amountField, setAmountField] = useState('Amount')
  const [scope, setScope] = useState<(typeof SCOPES)[number]['key']>('both')
  const [mode, setMode] = useState<(typeof MODES)[number]['key']>('review')
  if (sources.data?.sources.some((s) => s.kind === 'salesforce_opportunity')) return null
  const list = fields.split(',').map((f) => f.trim()).filter(Boolean)
  return (
    <section className={styles.card} aria-label="Opportunity notes" data-testid="pulse-opportunities-card">
      <h2 className={styles.head}>Salesforce opportunity notes</h2>
      <p className={styles.text}>
        Read the notes on opportunities as customer signals, with the opportunity's amount, stage and close date, so topics can show how much is at stake. Name the fields to read by their API names. Only those fields are read, nothing is
        written back, and "Wait for review" keeps anything sensitive from counting until someone has looked at it.
      </p>
      <div className={styles.add}>
        <TextInput id="opp-fields" data-testid="opp-fields" labelText="Fields to read (up to five)" helperText="For example NextStep, Description, Loss_Reason__c" value={fields} onChange={(e) => setFields(e.target.value)} />
        <TextInput id="opp-amount" data-testid="opp-amount" labelText="Amount field" value={amountField} onChange={(e) => setAmountField(e.target.value)} />
      </div>
      <div className={styles.row}>
        <Select id="opp-scope" data-testid="opp-scope" labelText="Which opportunities" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
          {SCOPES.map((s) => (
            <SelectItem key={s.key} value={s.key} text={s.label} />
          ))}
        </Select>
        <Select id="opp-mode" data-testid="opp-mode" labelText="New notes" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          {MODES.map((m) => (
            <SelectItem key={m.key} value={m.key} text={m.label} />
          ))}
        </Select>
      </div>
      {add.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Not added" subtitle={friendlyMessage(add.error)} data-testid="opp-add-error" />}
      <div>
        <Button kind="primary" size="md" data-testid="opp-add" disabled={!list.length || list.length > 5 || !amountField.trim() || add.isPending} onClick={() => add.mutate({ fields: list, scope, amountField: amountField.trim(), mode })}>
          {add.isPending ? 'Adding…' : 'Add opportunity notes'}
        </Button>
      </div>
    </section>
  )
}
