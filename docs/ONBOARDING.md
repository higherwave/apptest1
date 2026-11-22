# Workspace setup (onboarding for workspace owners)

Decisions so far (2026-11-17). Scope: **set-up and orientation for workspace owners only.** Everyone else has the guided tours.

- **Pattern:** the two-level onboarding flow (https://www.thehigherwave.com/#p=onb-two-level, prototype under /prototypes/onboarding/2-level-onboarding-flow/). Level 1 is a grid of
  category cards on one screen (number, status: In progress, Locked, Done, title, description); level 2 is a slide-over drawer from the right with a vertical step
  rail (Welcome, Set up, Review, Done) and a Continue button. Future categories are locked so people follow the path. Everything on one screen: nobody is sent away.
- **Categories (content approved):** Teams and people; Approvals; Experience categories; Connections (Slack, Jira; optional, can be skipped); Data and AI (retention and
  Trash, the monthly AI limit, the project lock; read and confirm).
- **Order:** either way works for now (nobody gets access until setup is done). Later, Connections may come first, because it is the part we may need to help with; the
  owner can then do people, approvals and categories alone.
- **One flow:** once the drawer is open, Continue / Next category carries on through the whole setup without going back to the grid.
- **Done means done:** the Review step reads the real workspace (for example, every launch step in use has an approver); a category is done when its check passes, or it
  was skipped (optional ones only).
- **Concept:** the "Workspace setup concept" page (Artifact) in the 2026-11-17 session.

## Required checks (decided 2026-11-18)

- **Teams and people:** someone besides the owner **who can edit** has been invited or has joined; every team has at least one person who can edit.
- **Approvals:** every launch step in use has an approver; the **final decision has a backup** (other backups are good to have, not required).
- **Experience categories:** at least one; a definition is optional (the quick add never asks for one).
- **Connections:** nothing required (Slack channel per team and Jira are optional).
- **Data and AI:** all three items confirmed; the server checks and records it (`acknowledged` on `PUT /setup/guard`).
- **The embedded screens are the real Settings screens**, so their own required fields (a team's name, an invite's email and role, an approver) hold in the setup exactly as in Settings;
  afterwards the Settings screens are simply the continuation of the setup. The setup's extra gates only decide when a category can be marked done.
- **The starter team is called Platform** (it was General): a nudge to use it for people who normally have access to everything. Not enforced; an owner can rename it.

## Flagged for December

- **Save halfway and come back**, with **reminders** (alerts after a set time) for owners who have not finished. Not built in the first version.
- Handing a category to a teammate, role-specific tracks, and an owner's view of each person's progress (the pattern's own "ways to extend").
- Possibly Connections first.

## Open

- Whether the Set up step embeds the real Settings forms (recommended) or starts as an explanation with a button into Settings.
- Where it appears: a "Set up your workspace" entry for owners until complete, reopenable; shown automatically on an owner's first visit?
