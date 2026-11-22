import { T } from '../../shared/terms.mjs'

/** What a locked project says: its requirements are published, so its transcripts, themes and requirements no longer change. */
export const lockText = (permanent: boolean) =>
  permanent
    ? 'The requirements are published and Jira tickets have been created, so this project is locked for good. Changes from here happen in a new project.'
    : `The requirements are published, so this project is locked: its transcripts, themes and requirements no longer change. Changes from here happen in a new project. A workspace owner or the final ${T.approver} can return the requirements to draft until the first Jira ticket is created.`
