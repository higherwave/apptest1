import { T } from '../../shared/terms.mjs'

// The guided tours. Written as a story: Anchor CX makes software for customer-success teams, and its product leaders have asked why
// customers stopped trusting the account health score. Each step points at a real part of the screen (a CSS selector) on a real page
// (a route); where a step has no target, or the target is not on the page, the card simply sits in the middle of the screen.
// ":project" in a route is the sample project the tour walks through; ":topic" is the Pulse topic the Pulse tour opens (the strongest one). A route may carry a query ("/pulse?tab=all").

export type TourStep = {
  title: string
  body: string
  /** The page the step is on. The tour goes there if it is somewhere else. */
  route: string
  /** What the step points at: a CSS selector. Without one, the card is centered. */
  target?: string
}

export type Tour = {
  id: 'insights' | 'project' | 'pulse'
  /** The app the tour belongs to: the welcome screen and the header's Take a tour offer only the tours of the app a person is in. */
  app: 'signal-flow' | 'pulse'
  title: string
  summary: string
  /** Minutes to read through it, as promised on the welcome screen. */
  minutes: number
  steps: TourStep[]
}

export const TOURS: Tour[] = [
  {
    id: 'insights',
    app: 'signal-flow',
    title: 'The view from the top',
    summary: 'See what Anchor CX has learned across all of its research, rolled up for product leaders.',
    minutes: 2,
    steps: [
      {
        title: 'Everything the team has learned, in one place',
        body: 'Anchor CX makes software for customer-success teams. Its leaders asked one question: why did customers stop trusting the health score? Three research projects later, this page holds the answer. It is a rollup across all of them, so you never have to open each project to see the big picture.',
        route: '/insights/themes',
        target: 'main h1',
      },
      {
        title: 'Start with what to do',
        body: 'These recommendations come from the themes underneath. Each says how many themes and how many projects point to it, and the dot shows how urgent it looks. Open one to see the evidence behind it.',
        route: '/insights/themes',
        target: '[data-testid^="rec-"]',
      },
      {
        title: 'Sort the themes at a glance',
        body: 'Every theme from every project is counted here: the ones that keep coming back as pain points, the opportunities, and the things that already worked after they shipped. Use Show to narrow the list below to one of them.',
        route: '/insights/themes',
        target: '[data-tour="theme-filters"]',
      },
      {
        title: 'One row, many conversations',
        body: 'A theme is something several customers said in their own words. This row shows how many of the people who were asked raised it, across how many projects, and whether it comes from customers or from the team. Customer feedback sets the priority; team feedback only adds weight to it.',
        route: '/insights/themes',
        target: '[data-testid^="platform-theme-"]',
      },
      {
        title: 'Who is behind the themes',
        body: 'Personas group what the themes say by kind of customer, so a leader can see who feels each pain, not just how many.',
        route: '/insights/personas',
        target: '[data-testid^="customer-"]',
      },
      {
        title: 'The journey the customer is on',
        body: 'Journeys lay the whole customer-success lifecycle out as a service blueprint: what the customer does, what the team does behind the scenes, and where research found friction. Every project is placed on it, so gaps and overlaps show up quickly.',
        route: '/insights/journey',
        target: '[data-testid="workflow-map"], [data-tour="journey-map"]',
      },
      {
        title: 'Proof that it worked',
        body: 'When something Anchor CX shipped is measured and works, it becomes a case study here. Closing the loop is how research earns its next round of funding.',
        route: '/insights/case-studies',
        target: '[data-testid^="case-row-"]',
      },
      {
        title: 'That is the view from the top',
        body: 'Everything here was built bottom-up from individual research projects. Want to see how one of them goes from customer conversations to tickets ready for Jira? The second tour follows one project all the way.',
        route: '/insights/case-studies',
      },
    ],
  },
  {
    id: 'project',
    app: 'signal-flow',
    title: 'From conversation to Jira ticket',
    summary: 'Follow one Anchor CX research project from customer conversations to tickets ready for Jira, and on to the launch decision.',
    minutes: 3,
    steps: [
      {
        title: 'One question, one project',
        body: 'Each research project starts with a question. Anchor CX\'s was: why do customers distrust the health score? This is Projects, where every project lives. We will follow one from the first conversation to the last ticket.',
        route: '/projects',
        target: '[data-status]',
      },
      {
        title: 'It starts with real conversations',
        body: 'Transcripts from customer calls go in here, from Zoom, Meet or Teams, or as files. Nothing is summarised yet. This is the raw material, with names masked before anything is analysed.',
        route: '/projects/:project/transcripts',
        target: '[data-testid^="transcript-"]',
      },
      {
        title: 'Themes, with the evidence attached',
        body: 'The analysis reads every transcript and finds what several people said in common. Each theme links back to the exact quotes, so nobody has to take the summary on trust.',
        route: '/projects/:project/themes',
        target: 'main h1',
      },
      {
        title: 'The journey, in the customer\'s words',
        body: 'The storyboard lays the themes along the customer\'s journey, with their feelings and the opportunities at each stage. You can see where the experience breaks down, not only what people complained about.',
        route: '/projects/:project/storyboard',
        target: 'main h1',
      },
      {
        title: 'Decide what matters most',
        body: 'Priorities score each theme by how many people raised it and how hard it is to fix. This is where research turns into a ranked list the team can argue about.',
        route: '/projects/:project/prio',
        target: '[data-tour="priority-matrix"]',
      },
      {
        title: 'Requirements, drafted from the evidence',
        body: 'The requirements writer turns the chosen themes into a document, one step at a time. A person approves every step, and every claim points back to the research behind it.',
        route: '/projects/:project/requirements',
        target: 'main h1',
      },
      {
        title: 'Designs sit next to the requirements',
        body: 'Each requirement gets a prototype link or a screenshot and the designer\'s notes, beside the reasoning that led to it.',
        route: '/projects/:project/design',
        target: '[data-testid^="design-"]',
      },
      {
        title: 'Ready for Jira',
        body: 'Publishing the requirements creates a board of stories. Each carries its theme, its priority and acceptance criteria, ready to hand off as a Jira ticket.',
        route: '/projects/:project/stories',
        target: '[data-testid^="story-"]',
      },
      {
        title: 'Launch: the go signals',
        body: `Before anything ships, each function that has a stake, such as support, legal or sales, gives its own go or no-go, with the evidence behind it. Everyone sees every section, and each ${T.approver} answers only their own. A step nobody covers shows as a gap, never hidden, and the final ${T.approver} signs off once the answers are in.`,
        route: '/projects/:project/launch',
        target: '[data-testid="launch-summary"], [data-testid="launch-start"], main h1',
      },
      {
        title: 'That is the whole path',
        body: 'From a customer\'s own words to a launch decision, with the evidence kept at every step. Back on Platform Insights, the same project rolls up with all the others.',
        route: '/projects/:project/launch',
      },
    ],
  },
  {
    id: 'pulse',
    app: 'pulse',
    title: 'What customers keep telling you',
    summary: 'See how Pulse turns what customers say in Slack, sales notes, support tickets and calls into a ranked list of topics worth researching.',
    minutes: 2,
    steps: [
      {
        title: 'Everything customers say, sorted for you',
        body: 'Anchor CX hears from customers all day: in Slack, in sales notes, in support tickets and on calls. Nobody has time to read it all, and the same complaint gets heard by five different people. Pulse reads those places and groups what is about the same thing into topics, so the pattern shows up without anyone sorting by hand.',
        route: '/pulse',
        target: 'main h1',
      },
      {
        title: 'Start with what counts most',
        body: 'The top topics come first. Each card says how many signals are behind it, how many accounts raised it, and how much revenue those accounts represent. A topic heard in direct customer words counts more than one heard second-hand, and the card shows the numbers behind its rank.',
        route: '/pulse',
        target: '[data-testid^="card-"]',
      },
      {
        title: 'Impact against how often it comes up',
        body: 'The map puts every top topic on two things at once: how widely it is heard and how much money is behind it. A topic in the top right is both common and costly, which is where research is worth the time.',
        route: '/pulse',
        target: '[data-testid="impact-map"]',
      },
      {
        title: 'Every topic, and why it ranks where it does',
        body: 'All Topics lists every pattern Pulse found. A topic shows where it was heard, whether it is rising or fading, and whether Signal Flow already has research on it, so nobody asks customers a question the team has already answered. The weights behind each score are visible, never hidden.',
        route: '/pulse?tab=all',
        target: '[data-testid="topics-grid"]',
      },
      {
        title: 'The customer\'s own words',
        body: 'Open a topic to read what people actually said, with where and who said it. The score is the sum of the signals times how much each place counts, laid out line by line, and a signal counts a little less as it gets older.',
        route: '/pulse/topics/:topic',
        target: '[data-testid="topic-quotes"]',
      },
      {
        title: 'Which accounts, and what is at stake',
        body: 'The accounts and people behind a topic are possible research participants, with the revenue from Salesforce beside each account. Open deals that mention the topic show what is riding on it.',
        route: '/pulse/topics/:topic',
        target: '[data-testid="topic-accounts"]',
      },
      {
        title: 'From a pattern to a research project',
        body: 'Pick the topics worth digging into and start a Signal Flow project from them in one click. Pulse drafts about one session\'s worth of questions from what customers said, each with the words that prompted it. Pulse tells you what to ask; Signal Flow is where you ask it.',
        route: '/pulse?tab=all',
        target: '[data-testid^="pick-"]',
      },
      {
        title: 'That is Pulse',
        body: 'What customers say, grouped and ranked, with the evidence one click away. When a project starts from a topic, the topic links to it, and what the research learns shows up in Signal Flow\'s Platform Insights.',
        route: '/pulse',
      },
    ],
  },
]

export const tourById = (id: string) => TOURS.find((t) => t.id === id)
