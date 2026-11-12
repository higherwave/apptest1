// How a requirement's measure reads as one sentence, shared by the server (which writes the plain metric, baseline and target from the parts) and the
// Measure page (which builds and shows the sentence). Pure functions, no dependencies.
//
//   We'll know this worked when <kind> <detail> <comparison> <value> [<mid> <value>] <unit>.
//   We'll know this worked when support tickets asking why a score changed go from 48 to 15 a month.

/** What is being measured; the detail that completes the sentence is free text. */
export const MEASURE_KINDS = [
  { key: 'tickets', label: 'Support tickets', hint: 'Volume of tickets on a topic' },
  { key: 'adoption', label: 'Adoption', hint: 'Share of people who start using it' },
  { key: 'engagement', label: 'Engagement', hint: 'How often people use it' },
  { key: 'time_to_value', label: 'Time-to-value', hint: 'How long until it pays off' },
  { key: 'retention', label: 'Retention', hint: 'Whether people keep coming back' },
  { key: 'feedback', label: 'Feedback', hint: 'What people say in sessions or surveys' },
  { key: 'other', label: 'Something else', hint: 'Describe it in your own words' },
]

/** How the measure is compared with the number. `two` means there is a second value, joined to the first by `mid`. */
export const MEASURE_COMPARISONS = [
  { key: 'change', label: 'go from', mid: 'to', two: true, hint: 'Before and after values' },
  { key: 'below', label: 'stay below', mid: '', two: false, hint: 'A ceiling to stay under' },
  { key: 'above', label: 'rise above', mid: '', two: false, hint: 'A floor to clear' },
  { key: 'between', label: 'stay between', mid: 'and', two: true, hint: 'A healthy range' },
  { key: 'reach', label: 'reach', mid: '', two: false, hint: 'A single target' },
]

const kindOf = (key) => MEASURE_KINDS.find((k) => k.key === key)
const cmpOf = (key) => MEASURE_COMPARISONS.find((c) => c.key === key)
const clean = (v) => (v == null ? '' : String(v).trim())
const join = (...parts) => parts.map(clean).filter(Boolean).join(' ')

/** The measure's subject: "Support tickets asking why a score changed". A row saved before the parts existed has only its metric text. */
export function signalText(m) {
  const kind = kindOf(m.metricKind)
  if (!kind) return clean(m.metric)
  return kind.key === 'other' ? clean(m.detail) : join(kind.label, m.detail)
}

/** What it should come to: "48 → 15 a month", "below 5%", "goal 20 a week". Legacy rows use their baseline and target. */
export function goalText(m) {
  const cmp = cmpOf(m.comparison)
  const a = clean(m.valueA)
  const b = clean(m.valueB)
  const unit = clean(m.unit)
  if (!cmp) {
    if (clean(m.baseline) && clean(m.target)) return `${clean(m.baseline)} → ${clean(m.target)}`
    return clean(m.target) ? `goal ${clean(m.target)}` : clean(m.baseline)
  }
  if (!a) return ''
  switch (cmp.key) {
    case 'change': return join(b ? `${a} → ${b}` : a, unit)
    case 'between': return join(b ? `${a}–${b}` : a, unit)
    case 'below': return join('below', a, unit)
    case 'above': return join('above', a, unit)
    default: return join('goal', a, unit)
  }
}

/** The plain metric, baseline and target written from the parts, so everything that reads them keeps working. Null when there are no parts. */
export function compatFields(m) {
  const kind = kindOf(m.metricKind)
  if (!kind) return null
  const cmp = cmpOf(m.comparison)
  const a = clean(m.valueA)
  const b = clean(m.valueB)
  const unit = clean(m.unit)
  let baseline = null
  let target = null
  if (cmp && a) {
    if (cmp.key === 'change') {
      baseline = join(a, unit) || null
      target = b ? join(b, unit) : null
    } else {
      target = goalText(m) || null
    }
  }
  return { metric: signalText(m) || null, baseline, target }
}

/** A reading with its unit when it is only a number ("11" and "a month" read "11 a month"); a reading that already says more is left alone. */
export function readingText(value, unit) {
  const v = clean(value)
  const u = clean(unit)
  if (!v) return ''
  return u && /^[\d.,]+$/.test(v) ? `${v} ${u}` : v
}

/** The sentence as plain text, for a screen reader or a summary: "We'll know this worked when ...". Empty until there is something to say. */
export function sentenceText(m) {
  const signal = signalText(m)
  if (!signal) return ''
  const cmp = cmpOf(m.comparison)
  const a = clean(m.valueA)
  const b = clean(m.valueB)
  if (!cmp || !a) return `We'll know this worked when ${signal} ${cmp ? cmp.label : 'changes'}.`
  return `We'll know this worked when ${join(signal, cmp.label, a, cmp.two && b ? cmp.mid : '', cmp.two ? b : '', m.unit)}.`
}
