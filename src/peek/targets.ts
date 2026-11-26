// What a quick-reference drawer can show, and where its "view details" link goes. No React in here, so it is easy to test.
export type PeekKind = 'theme' | 'project' | 'topic' | 'case'
export type PeekTarget = { kind: PeekKind; id: string }

// The full page for a target. A project opens on its themes once it has some, on its plan before that.
export function peekHref(target: PeekTarget, project?: { status: 'draft' | 'analyzed' }): string {
  if (target.kind === 'theme') return `/insights/themes?theme=${encodeURIComponent(target.id)}`
  if (target.kind === 'topic') return `/pulse/topics/${encodeURIComponent(target.id)}`
  if (target.kind === 'case') return `/insights/case-studies?project=${encodeURIComponent(target.id)}` // the id is the project's
  return `/projects/${encodeURIComponent(target.id)}/${project?.status === 'analyzed' ? 'themes' : 'plan'}`
}

/** An ordinary click opens the drawer; a modified or middle click keeps the link's own behaviour (a new tab or window). */
export const isPlainClick = (e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number }) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
