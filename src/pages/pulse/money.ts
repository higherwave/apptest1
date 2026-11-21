// ARR as shown in Pulse: US dollars, compact ($240K, $1.2M). Salesforce's currency is assumed to be one currency; a note on the Admin card says so.
const compact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })
const full = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
export const money = (n: number) => compact.format(n)
export const moneyFull = (n: number) => full.format(n)

type Opp = { name: string; amount: number | null; stage: string | null; closeDate: string | null; state: 'open' | 'lost' | 'won' }
/** One line about the opportunity behind a signal: "Renewal Q1 · Negotiation · $240K · closes Dec 15" (or "lost"). */
export const oppLine = (o: Opp) =>
  [
    o.name || 'Opportunity',
    o.stage,
    o.amount !== null ? money(o.amount) : null,
    o.state === 'open' && o.closeDate ? `closes ${new Date(`${o.closeDate}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : o.state === 'lost' ? 'lost' : o.state === 'won' ? 'won' : null,
  ]
    .filter(Boolean)
    .join(' · ')
