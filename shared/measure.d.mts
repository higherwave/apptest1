export type MeasureKindKey = 'tickets' | 'adoption' | 'engagement' | 'time_to_value' | 'retention' | 'feedback' | 'other'
export type MeasureComparisonKey = 'change' | 'below' | 'above' | 'between' | 'reach'
export const MEASURE_KINDS: { key: MeasureKindKey; label: string; hint: string }[]
export const MEASURE_COMPARISONS: { key: MeasureComparisonKey; label: string; mid: string; two: boolean; hint: string }[]
export type MeasureParts = {
  metricKind?: string | null
  detail?: string | null
  comparison?: string | null
  valueA?: string | null
  valueB?: string | null
  unit?: string | null
  metric?: string | null
  baseline?: string | null
  target?: string | null
}
export function signalText(m: MeasureParts): string
export function goalText(m: MeasureParts): string
export function compatFields(m: MeasureParts): { metric: string | null; baseline: string | null; target: string | null } | null
export function readingText(value: string | null | undefined, unit: string | null | undefined): string
export function sentenceText(m: MeasureParts): string
