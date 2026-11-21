// ARR as shown in Pulse: US dollars, compact ($240K, $1.2M). Salesforce's currency is assumed to be one currency; a note on the Admin card says so.
const compact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })
const full = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
export const money = (n: number) => compact.format(n)
export const moneyFull = (n: number) => full.format(n)
