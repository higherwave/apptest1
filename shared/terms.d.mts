export type TermKey = 'approver' | 'approvers' | 'backup' | 'backups' | 'approvals'
export type Terms = Readonly<
  Record<TermKey, string> & Record<'Approver' | 'Approvers' | 'Backup' | 'Backups' | 'Approvals', string> & { a: (key: TermKey) => string; A: (key: TermKey) => string }
>
export function makeTerms(words?: Partial<Record<TermKey, string>>): Terms
export const T: Terms
