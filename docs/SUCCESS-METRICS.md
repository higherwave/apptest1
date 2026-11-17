# "How will we know it worked?": the launch's success view

Decisions so far (2026-11-17):

- **Measure stays visible** for now, as its own section. It is good for demos and discussion. Turning it off is a per-workspace switch, to be used when the app
  runs on a real pilot project, not before.
- **A third tab on the launch screen** (after Launch Summary and Product Brief) is the first step towards closing the loop. For now it is **read-only reference**:
  it shows what success was defined to be and what has been read so far; it does not collect anything. Later it completes the loop (readings arrive, the result
  is judged, and it flows back to the Platform Insights themes as "worked" or "needs attention").
- **Built to grow into three kinds of signal**, so nothing in the first version has to be thrown away:
  1. **Telemetry**: product analytics (events, funnels, adoption, usage).
  2. **Support**: the support system (ticket volume on the topic, contact rate, escalations, satisfaction).
  3. **User feedback**: what people say (interview transcripts, surveys, in-product comments), where the research itself is the baseline.
- Until a source is connected, a measure is read by hand (as Measure works today). A measure says which kind of signal it would come from.

## What the tab shows (first version, read-only)

1. **What success looks like**: the goals and success metrics from the product brief (step 3 of the requirements), as the reference statement.
2. **The measures**: one row per requirement that has a measure on Measure: the one-sentence measure, the target, the latest reading and its status, and the
   research behind it ("4 of 4 people struggled with this"). A link to Measure to edit.
3. **Where we will look**: each measure tagged Telemetry, Support or Feedback, with the state of that source: Not connected, Read by hand, or (later) Connected.
4. **When we will know**: review points after launch (for example 30, 60 and 90 days from the target date) and who reviews.

## Growth path (not built)

- A workspace registers signal sources (type, product, how to reach it); a measure points at a source and a query or report; readings carry their source.
- Telemetry and support readings arrive automatically; feedback readings come from new transcripts matched to the same themes.
- The verdict (worked, needs attention, too early) is proposed from the readings against the target and confirmed by a person, then written back to the theme.
- Integrations come from pilot feedback, not in advance.
