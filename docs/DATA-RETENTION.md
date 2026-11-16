# Data retention and removal

How long Signal Flow keeps a customer's data, how a customer takes it away, and how to carry out each rule. Decided 2026-11-16. These are the defaults for every workspace; a per-workspace setting and proactive reminders for admins come later.

Assumption behind the periods: a release cycle is quarterly to every six months, and the customer can download their data at any time.

## The rules

| What | How long | What happens after |
|---|---|---|
| Projects, transcripts, quotes, themes, requirements, stories, launch answers, journeys, categories | For the life of the workspace. They are how the system learns from one release to the next, and every quote must stay traceable to the words behind it. | Removed only when the customer deletes them or the agreement ends |
| Anything a person deletes (a project, a requirements document, a journey) | 90 days in **My deleted items** (the Trash) | Removed for good. Owners can also **Delete now**. |
| Audit log, AI usage records | 12 months | Removed. Downloadable at any time before that (Admin, Data). |
| Records of messages sent (email, Slack) | Content removed after 12 months | The row stays as a marker that the message was sent, so a long-running launch never repeats a message |
| Documents and PDFs | Not stored | Made from the saved data whenever someone opens or exports one |
| A workspace whose agreement has ended | 30 days after the end date, so the customer can still export | Removed, with a written confirmation (`db/remove-workspace.mjs`) |
| Slack conversations, Jira tickets | Not ours: they stay in the customer's own accounts | |
| What was sent to the AI provider | Deleted by the provider within 30 days (their published terms; see the data location statement) | |
| Database backups | The database provider's own schedule (a few days on the paid plan) | A removed item can sit in a backup until it expires; it is never restored into the live service |

## A legal hold

A hold keeps what it covers. While it is in force, nothing under it is deleted for good, by anyone, and the clean-up skips it. There is no maximum: it lasts until an owner of the workspace releases it (Admin, Data, Legal hold). A hold on a project covers that project; a hold on the workspace covers everything; any hold also pauses the removal of old audit and usage records, which are the evidence of what happened to the held material. Placing and releasing a hold are in the audit log, with who and why. A hold cannot extend what the AI provider keeps, and backups expire on their own schedule. Counsel should confirm the wording before it goes in a customer-facing policy.

## How each rule is carried out

- **Download.** Admin, Data: all data (ZIP of every table as JSON plus readable files per project), the audit log (CSV) and the AI usage (CSV). Owners only; each download is in the audit log. `server/export.ts`.
- **Move to the Trash / Delete now.** The delete dialog on a project offers **Move to Trash** (anyone who edits) and **Delete now** (owners, with a second confirmation). `server/trash.ts` snapshots the item and everything under it, then deletes it from the live tables; restoring puts the same rows back with the same ids. **My deleted items** is in the avatar menu whenever there is something in it: an owner sees everything in the workspace, an editor sees what they deleted.
- **The daily clean-up.** `runRetention` in `server/retention.ts`, run by the reminder job (`/cron/digest`). It removes Trash entries past 90 days, audit and usage records past 12 months, and the content of old message records. It writes "removed after 90 days" to the audit log for each Trash entry it removes. It skips what a hold covers.
- **End of an agreement.** Tell the customer the end date and that they can download everything (Admin, Data). Hold the data for 30 days. Then `node db/remove-workspace.mjs --workspace <slug>` (a dry run shows what would go and whether a hold stops it), then again with `--confirm <slug> --yes`. It prints a written confirmation, including the day the last backup expires: send it and keep a copy. It refuses while a hold is in force.
- **A request to erase a person's data.** A person in an interview can ask for their data to be deleted. The 90-day Trash must not delay that: an owner uses **Delete now** (the project, with its transcripts, or the participant's details by editing the participant). Erasing one person from a project that is otherwise kept is not automated yet: do it by hand, and tell the requester when it is done. Statutory response times apply (California: 45 days): ask counsel.

## What is not built yet

- Per-workspace retention settings and reminders that tell admins what is about to age out.
- Erasure of one participant from a kept project (transcript text and quotes) as a single action.
- Putting back a single transcript or participant that was removed inside a save: only whole projects, documents and journeys go to the Trash.
- A workspace-wide "restore everything" after a bad day: restore each item, or use the provider's point-in-time restore (a platform action, not a customer one).
