import {
  Button,
  InlineNotification,
  Loading,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
} from "@carbon/react";
import { useState } from "react";
import type {
  BoardStory,
  CreateTicketInput,
  JiraStatus,
  ProjectDetail,
  StoryDetail,
  Ticket,
} from "../../api/client";
import { ProjectHeader } from "../project/ProjectHeader";
import { CreateTicketModal } from "./CreateTicketModal";
import { priorityLabel, readiness, storyMarkdown } from "./jira";
import styles from "./StoriesView.module.scss";

export type StoriesViewProps = {
  state: "loading" | "error" | "empty" | "ready";
  project?: ProjectDetail;
  stories: BoardStory[];
  tickets: Ticket[];
  tab: "prepare" | "sent";
  openId: string | null;
  detail?: StoryDetail;
  canEdit: boolean;
  errorText?: string;
  creating: boolean;
  createError?: string;
  /** The ticket just made, to confirm it: the story has left Prepare for Jira, so this says where it went. */
  justSent: { jiraKey: string; storyKey: string; url: string | null } | null;
  /** The Jira connection, when there is one (the Create ticket dialog then offers Jira's own options). */
  jira?: JiraStatus;
  /** A story key to mark in the Sent to Jira list (arriving from a link to a story that has been sent). */
  highlightKey: string | null;
  /** The address of a story in this tool, which goes into the ticket as its evidence link. */
  linkTo: (story: { key: string }) => string;
  onTab: (tab: "prepare" | "sent") => void;
  onOpen: (id: string) => void;
  onDismissSent: () => void;
  /** Resolves true when the ticket was made (the dialog then closes). */
  onCreate: (storyId: string, input: CreateTicketInput) => Promise<boolean>;
  onGoRequirements: () => void;
  /** Opens the Design step with this requirement's row open. */
  onViewDesign: (story: BoardStory) => void;
  /** Opens Measure at this requirement: how it will be known to have worked. */
  onViewMeasure: (story: BoardStory) => void;
};

const byKey = (a: BoardStory, b: BoardStory) =>
  a.key.localeCompare(b.key, undefined, { numeric: true });
const when = (iso: string) =>
  new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Presentational: the Stories step as a hand-off to Jira. Prepare for Jira lists the requirements still to send (and the open questions) to the left and
// shows the selected one in full, read-only (the document is the source), with its evidence and, at the bottom, what is still thin and the buttons.
// A requirement that has been sent leaves that list and is in Sent to Jira, the record. The only editing is in the Create ticket dialog.
export function StoriesView(props: StoriesViewProps) {
  const { state, stories, tickets, tab, openId, errorText, justSent } = props;
  const sentIds = new Set(tickets.map((t) => t.storyId));
  const requirements = stories
    .filter((s) => s.kind === "requirement")
    .sort(byKey);
  const toPrepare = requirements.filter((s) => !sentIds.has(s.id));
  const questions = stories
    .filter((s) => s.kind === "open_question")
    .sort(byKey);
  const opened = [...toPrepare, ...questions].find((s) => s.id === openId);
  const allSent = toPrepare.length === 0 && tickets.length > 0;

  return (
    <div className={styles.page}>
      <ProjectHeader
        title="Stories"
        description={
          state === "ready"
            ? `${plural(requirements.length, "requirement")} from the requirements document: ${toPrepare.length} to prepare, ${tickets.length} sent to Jira.`
            : "Each requirement from the published document, prepared for Jira."
        }
      />
      {errorText && (
        <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          title="Something went wrong"
          subtitle={errorText}
        />
      )}
      {state === "loading" && (
        <Loading small withOverlay={false} description="Loading the stories" />
      )}
      {state === "error" && !errorText && (
        <p className={styles.empty}>The stories could not be loaded.</p>
      )}
      {state === "empty" && (
        <div className={styles.emptyState}>
          <p className={styles.empty}>
            Publish a requirements document and its requirements appear here,
            ready for Jira.
          </p>
          <Button kind="primary" size="md" onClick={props.onGoRequirements}>
            Go to Requirements
          </Button>
        </div>
      )}
      {state === "ready" && (
        <Tabs
          selectedIndex={tab === "sent" ? 1 : 0}
          onChange={({ selectedIndex }) =>
            props.onTab(selectedIndex === 1 ? "sent" : "prepare")
          }
        >
          <TabList aria-label="Stories">
            <Tab data-testid="tab-prepare">
              Prepare for Jira · {toPrepare.length}
            </Tab>
            <Tab data-testid="tab-sent">Sent to Jira · {tickets.length}</Tab>
          </TabList>
          <TabPanels>
            <TabPanel className={styles.tabPanel}>
              {tab === "prepare" && (
                <div className={styles.prepare}>
                  {justSent && (
                    <div className={styles.confirm}>
                      <InlineNotification
                        kind="success"
                        lowContrast
                        title={`${justSent.jiraKey} created`}
                        subtitle={justSent.url ? `${justSent.storyKey} is now in Jira and in Sent to Jira.` : `${justSent.storyKey} is now in Sent to Jira.`}
                        data-testid="ticket-confirmation"
                        onCloseButtonClick={props.onDismissSent}
                      />
                      <Button
                        kind="ghost"
                        size="sm"
                        onClick={() => props.onTab("sent")}
                      >
                        View in Sent to Jira
                      </Button>
                      {justSent.url && (
                        <Button kind="ghost" size="sm" href={justSent.url} target="_blank" rel="noreferrer" data-testid="open-in-jira">
                          Open {justSent.jiraKey} in Jira
                        </Button>
                      )}
                    </div>
                  )}
                  {allSent && (
                    <InlineNotification
                      kind="info"
                      lowContrast
                      hideCloseButton
                      title="Every requirement has been sent to Jira"
                      subtitle="New ones appear here after the next published document."
                      data-testid="all-sent"
                    />
                  )}
                  <div className={styles.workspace}>
                    <nav className={styles.list} aria-label="Requirements">
                      <Group
                        title="To prepare"
                        stories={toPrepare}
                        openId={openId}
                        onOpen={props.onOpen}
                      />
                      <Group
                        title="Needs a decision"
                        stories={questions}
                        openId={openId}
                        onOpen={props.onOpen}
                      />
                      {toPrepare.length === 0 && questions.length === 0 && (
                        <p className={styles.listEmpty}>Nothing to prepare.</p>
                      )}
                    </nav>
                    {opened ? (
                      <Selected key={opened.id} story={opened} {...props} />
                    ) : (
                      <p className={styles.empty}>
                        {allSent
                          ? "Nothing left to prepare. The record is in Sent to Jira."
                          : "Choose a requirement."}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </TabPanel>
            <TabPanel className={styles.tabPanel}>
              {tab === "sent" && (
                <SentList tickets={tickets} highlightKey={props.highlightKey} />
              )}
            </TabPanel>
          </TabPanels>
        </Tabs>
      )}
    </div>
  );
}

function Group({
  title,
  stories,
  openId,
  onOpen,
}: {
  title: string;
  stories: BoardStory[];
  openId: string | null;
  onOpen: (id: string) => void;
}) {
  if (stories.length === 0) return null;
  return (
    <section className={styles.group} aria-label={title}>
      <h2 className={styles.groupHead}>{title}</h2>
      {stories.map((s) => (
        <Button
          key={s.id}
          kind="ghost"
          size="md"
          className={styles.item}
          data-testid={`story-${s.key}`}
          aria-current={s.id === openId ? "true" : undefined}
          onClick={() => onOpen(s.id)}
        >
          <span className={styles.itemText}>
            <strong>{s.key}</strong> {s.title}
          </span>
        </Button>
      ))}
    </section>
  );
}

type SelectedProps = StoriesViewProps & { story: BoardStory };

// The selected story, all of it and read-only, then its evidence, and a strip at the bottom (it stays in view on a long story) with what is
// still thin, Create Jira ticket and Copy as Markdown. An open question has the decision note in place of the ticket button.
function Selected({
  story,
  detail,
  canEdit,
  creating,
  createError,
  jira,
  linkTo,
  onCreate,
  onViewDesign,
  onViewMeasure,
}: SelectedProps) {
  const [modal, setModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const question = story.kind === "open_question";
  const link = linkTo(story);
  const checks = detail ? readiness(detail) : [];
  const criteria =
    detail?.checklist.filter((c) => c.kind === "criterion") ?? [];
  const tasks = detail?.checklist.filter((c) => c.kind === "task") ?? [];
  return (
    <>
      <article
        className={styles.detail}
        aria-label={`${story.key} ${story.title}`}
        data-testid="story-detail"
      >
        <p className={styles.kicker}>
          {story.key} · {story.theme?.title ?? "No theme"}
        </p>
        <h2 className={styles.title}>{story.title}</h2>
        <div className={styles.tags}>
          {question ? (
            <Tag size="md" type="purple">
              Open question
            </Tag>
          ) : (
            <Tag size="md" type="outline">
              {priorityLabel(story.priority)} priority
            </Tag>
          )}
          {!question && (
            <Button kind="ghost" size="sm" onClick={() => onViewDesign(story)}>
              Design →
            </Button>
          )}
          {!question && (
            <Button kind="ghost" size="sm" data-testid="open-measure" onClick={() => onViewMeasure(story)}>
              Measure →
            </Button>
          )}
        </div>
        {!detail && (
          <Loading small withOverlay={false} description="Loading the story" />
        )}
        {detail && (
          <>
            {detail.syncNote && (
              <InlineNotification
                kind="warning"
                lowContrast
                hideCloseButton
                title="Out of step with the document"
                subtitle={detail.syncNote}
              />
            )}
            {detail.summary && (
              <section className={styles.block} aria-label="Story">
                <h3 className={styles.blockHead}>Story</h3>
                <p className={styles.text}>{detail.summary}</p>
              </section>
            )}
            <section className={styles.block} aria-label="Acceptance criteria">
              <h3 className={styles.blockHead}>Acceptance criteria</h3>
              {criteria.length === 0 ? (
                <p className={styles.muted}>No acceptance criteria yet.</p>
              ) : (
                <ul className={styles.criteria}>
                  {criteria.map((c) => (
                    <li key={c.id}>{c.text}</li>
                  ))}
                </ul>
              )}
            </section>
            {tasks.length > 0 && (
              <section className={styles.block} aria-label="Tasks">
                <h3 className={styles.blockHead}>Tasks</h3>
                <ul className={styles.criteria}>
                  {tasks.map((c) => (
                    <li key={c.id}>{c.text}</li>
                  ))}
                </ul>
              </section>
            )}
            <div className={styles.pair}>
              {detail.whyItMatters && (
                <section className={styles.block} aria-label="Why it matters">
                  <h3 className={styles.blockHead}>Why it matters</h3>
                  <p className={styles.text}>{detail.whyItMatters}</p>
                </section>
              )}
              {detail.nextStep && (
                <section className={styles.block} aria-label="Next step">
                  <h3 className={styles.blockHead}>Next step</h3>
                  <p className={styles.text}>{detail.nextStep}</p>
                </section>
              )}
            </div>
            <section
              className={styles.block}
              aria-label="Evidence"
              data-testid="evidence"
            >
              <h3 className={styles.blockHead}>Evidence</h3>
              {story.theme ? (
                <p className={styles.text}>
                  Raised by {story.theme.participantCount} of{" "}
                  {story.theme.totalParticipants} participants ·{" "}
                  {story.theme.title}
                </p>
              ) : (
                <p className={styles.muted}>No theme behind it.</p>
              )}
              {!question && (
                <p className={styles.link}>Link in the ticket: {link}</p>
              )}
            </section>
          </>
        )}

        <div className={styles.actions} data-testid="story-actions">
          {question ? (
            <p className={styles.actionNote}>
              An open question is a decision to make, not a ticket. Once it is
              decided, the answer belongs in the requirements document.
            </p>
          ) : (
            detail && (
              <ul className={styles.checks} aria-label="Readiness">
                {checks.map((c) => (
                  <li key={c.label} data-ok={c.ok}>
                    <span aria-hidden>{c.ok ? "✓" : "○"}</span> {c.label}
                  </li>
                ))}
              </ul>
            )
          )}
          <div className={styles.buttons}>
            {!question && (
              <Button
                kind="primary"
                size="md"
                disabled={!canEdit || !detail}
                data-testid="create-ticket"
                onClick={() => setModal(true)}
              >
                Create Jira ticket
              </Button>
            )}
            <Button
              kind="ghost"
              size="md"
              disabled={!detail}
              onClick={() => {
                if (!detail) return;
                void navigator.clipboard
                  ?.writeText(storyMarkdown(detail, link))
                  .catch(() => undefined);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Copied" : "Copy as Markdown"}
            </Button>
          </div>
        </div>
      </article>
      {detail && !question && (
        <CreateTicketModal
          story={detail}
          link={link}
          open={modal}
          pending={creating}
          errorText={createError}
          jira={jira}
          onClose={() => setModal(false)}
          onCreate={(input) =>
            void onCreate(story.id, input).then(
              (made) => made && setModal(false),
            )
          }
        />
      )}
    </>
  );
}

// The record: what was sent, to which project, by whom and when.
function SentList({
  tickets,
  highlightKey,
}: {
  tickets: Ticket[];
  highlightKey: string | null;
}) {
  return (
    <div className={styles.sent}>
      <p className={styles.muted}>
        Stories sent to Jira from this tool. A key that is a link is a real
        issue in Jira; the others were made while the connection was simulated,
        so nothing reached Jira.
      </p>
      {tickets.length === 0 ? (
        <p className={styles.emptyBox}>
          Nothing sent yet. Open a requirement on Prepare for Jira and choose
          Create Jira ticket.
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <div
            className={styles.table}
            role="table"
            aria-label="Tickets sent to Jira"
            data-testid="sent-table"
          >
            <div className={styles.row} role="row">
              {[
                "Jira key",
                "Summary",
                "Story",
                "Priority",
                "Assignee",
                "Created by",
                "Created",
              ].map((h) => (
                <div key={h} className={styles.head} role="columnheader">
                  {h}
                </div>
              ))}
            </div>
            {tickets.map((t) => (
              <div
                key={t.id}
                className={styles.row}
                role="row"
                data-testid={`ticket-${t.jiraKey}`}
                data-highlight={t.storyKey === highlightKey}
              >
                <div role="cell" className={styles.jiraKey}>
                  {t.jiraUrl ? (
                    <a href={t.jiraUrl} target="_blank" rel="noreferrer" data-testid={`jira-link-${t.jiraKey}`}>
                      {t.jiraKey}
                    </a>
                  ) : (
                    t.jiraKey
                  )}
                </div>
                <div role="cell">
                  <p className={styles.summary}>{t.summary}</p>
                  <p className={styles.meta}>
                    {t.issueType} · {t.project}
                    {t.labels ? ` · ${t.labels}` : ""}
                  </p>
                </div>
                <div role="cell">{t.storyKey}</div>
                <div role="cell">{t.priority}</div>
                <div role="cell">{t.assignee}</div>
                <div role="cell">{t.createdBy?.name ?? "Someone"}</div>
                <div role="cell" className={styles.when}>
                  {when(t.createdAt)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
