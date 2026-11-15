// The words the product uses for the people who sign off a launch step, in one place. Every sentence a person reads (screens, emails, Slack posts, PDFs,
// error messages) takes these words from here, so a change of terminology (a customer asks for "reviewer", the market moves to "sign-off owner") is made
// by changing this file, not by searching the code. What stays fixed on purpose is the contract underneath: database tables, API paths and fields
// (`/approvals`, `approver`, `backup`), error codes and the names inside the code. Those are names, not wording, and renaming them would break scripts and
// stored data for a change of label.
//
// Scope: the nouns. The verbs around them ("approves this step", "Approved by") are plain English in the sentences and are edited with them. The
// requirements writer's own "Approve" button is a different thing and is not part of this vocabulary.
//
// A different vocabulary can be made with `makeTerms({ approver: 'reviewer', approvers: 'reviewers', ... })`; `T` is the one the product uses.

const DEFAULTS = { approver: 'approver', approvers: 'approvers', backup: 'backup', backups: 'backups', approvals: 'approvals' }

const upper = (w) => w.charAt(0).toUpperCase() + w.slice(1)
const article = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a')

/** The vocabulary: `T.approver`, `T.Approver` (capitalised), `T.a('approver')` ("an approver", "a reviewer" if the word changes), `T.A(...)` ("An approver"). */
export function makeTerms(words = {}) {
  const w = { ...DEFAULTS, ...words }
  const t = { ...w }
  for (const [k, v] of Object.entries(w)) t[upper(k)] = upper(v)
  t.a = (key) => `${article(t[key])} ${t[key]}`
  t.A = (key) => upper(`${article(t[key])} ${t[key]}`)
  return Object.freeze(t)
}

export const T = makeTerms()
