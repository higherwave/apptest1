# Anchor CX: demo story and test transcripts

**Anchor CX** is a fictional customer-success and support-operations platform for B2B software companies. Its customers' teams use it to
see every customer in one place (the *Customer 360* with a timeline), judge account health (the *health score* and *risk alerts*), run
*renewal playbooks*, share context between support and success, and report to leadership.

The story: four kinds of people at Anchor CX's customers use the same product and want different things. Anchor CX's product team uses
Signal Flow to turn three rounds of research into requirements, designs and measured results, and to keep what it learns for the next team.

## The four personas (the first words of each role, which is how Signal Flow groups Personas)

| Persona | Role text starts with | What they care about |
|---|---|---|
| Customer Success Manager | "Customer Success Manager, …" | Preparing renewals fast, trusting the health score, not losing context |
| Support Lead | "Support Lead, …" | Clean handoffs to success, early warning, less manual reporting |
| CS Operations Manager | "CS Operations Manager, …" | Explaining the score, flexible playbooks, reports that build themselves |
| Executive | "Executive, …" | Which renewals are at risk and why, board-ready answers, no dropped handoffs |

## The three studies (12 transcripts: one of each persona per study)

The transcripts are grouped by persona: `transcripts/csm/`, `transcripts/csops/`, `transcripts/exec/` and `transcripts/support/`, three files each (one per study). The `s1`, `s2` and `s3` at the start of each file name says which study it belongs to.

Create each as its own project in Signal Flow, add its four participants (from `participants.csv`), then upload its four transcripts on the Transcripts page and choose Save and analyze.
The speaker names in the files match the participant names, so quotes link to people and the Personas page groups them.

1. **Health score trust** (Discovery interviews, October 2026). Files `s1-*` in the four persona folders under `transcripts/`. Why do people not trust the health score, and how do they find out about risk?
2. **Renewal workspace** (Usability test, October 2026). Files `s2-*` in the persona folders. A prototype shows risk factors beside the score, a handoff button and flexible playbooks. Does it earn trust?
3. **Portfolio reporting** (Concept test, November 2026). Files `s3-*` in the persona folders. Concepts for a weekly digest, a drill-down portfolio dashboard and a board-ready export.

Suggested test plan for each (name it as above, add the methods shown):

| Study | Methods | What are we testing? | Outcomes to look for |
|---|---|---|---|
| 1 | Contextual interview | How people judge account health today and learn about risk | Where trust breaks; how risk is found; where context is lost |
| 2 | Moderated usability test | The renewal workspace prototype: risk factors, handoff to support, segment playbooks | Can people prepare a renewal without leaving the page; do they trust the score |
| 3 | Concept test | The portfolio dashboard, weekly digest and board export | Does it replace manual reporting; what would leaders act on |

Suggested tasks: (1) "Tell me about the last time you got ready for a customer check-in." (2) "How do you hear about an account at risk?" (3) "Walk me through handing a hard case to another team." (4) "How do you report on the portfolio today?"

## The themes you should see

These run through all three studies, which is what makes the cross-project views interesting.

| Theme | Who says it | Type |
|---|---|---|
| "I can't see why the health score changed, so I don't trust it" | Everyone, in all three studies | Pain point |
| Support and success lose context at the handoff | Support leads, CSMs, executives | Pain point |
| Preparing a renewal means jumping between tabs and tools | CSMs, CS ops | Pain point |
| Alerts are noisy and the early warning comes late | CSMs, support, executives | Pain point |
| Reporting to leadership is manual and out of date | CS ops, executives | Pain point |
| Playbooks should adapt to the customer segment | CSMs, CS ops | Expectation |
| The customer timeline saves real time | CSMs, support leads, executives | Delight |

Study 1 finds the problems, study 2 shows the risk-factor panel starting to earn trust, and study 3 shows leaders wanting digests and board-ready answers.

## A story to tell with the results

After requirements are published, the Measure step can hold the findings the story needs. For example: *Health score explanation shown on every account*, measured
by **"support tickets asking why a score changed"**, source **Support tickets**, before **48 a month**, goal **15 a month**; a finding of **11 a month** marks it **Worked**.
*Weekly digest instead of alerts*, measured by **"alerts ignored or muted"** (Telemetry), before **70%**, goal **30%**. *Handoff button*, measured by **"escalations missed by the CSM"**
(Business KPI), before **9 a quarter**, goal **2 a quarter**. A project with something that worked and nothing needing attention then appears on Case Studies, ready to copy a prompt for Claude Design.

## Notes

- All names, companies and numbers are invented. The email addresses use `.example` domains and the phone numbers use the reserved 555-01xx range.
- The files use the three formats the Transcripts page reads: Zoom `.vtt`, Teams `.vtt` and Meet `.txt`. Studies mix them on purpose.
- Platform Insights rolls themes up across projects by matching them to *platform themes*. The ones in the demo workspace are about clinic booking, so Anchor CX themes will not roll up across the three studies until Anchor CX platform themes are added to the demo data. That is app work and is not done yet.
