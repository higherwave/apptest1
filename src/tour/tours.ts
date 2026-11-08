// The guided tours. Written as a story: Anchor CX makes software for customer-success teams, and its product leaders have asked why
// customers stopped trusting the account health score. Each step points at a real part of the screen (a CSS selector) on a real page
// (a route); where a step has no target, or the target is not on the page, the card simply sits in the middle of the screen.
// ":project" in a route is the sample project the tour walks through.

export type TourStep = {
  title: string
  body: string
  /** The page the step is on. The tour goes there if it is somewhere else. */
  route: string
  /** What the step points at: a CSS selector. Without one, the card is centered. */
  target?: string
}

export type Tour = {
  id: 'insights' | 'project'
  title: string
  summary: string
  /** Minutes to read through it, as promised on the welcome screen. */
  minutes: number
  steps: TourStep[]
}

export const TOURS: Tour[] = [
  {
    id: 'insights',
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
        body: 'Every theme from every project is counted here: the ones that keep coming back as pain points, the opportunities, and the things that already worked after they shipped. Pick a card to filter the list below.',
        route: '/insights/themes',
        target: '[data-tour="filter-cards"]',
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
        body: 'Workflows lay the whole customer-success lifecycle out as a service blueprint: what the customer does, what the team does behind the scenes, and where research found friction. Every project is placed on it, so gaps and overlaps show up quickly.',
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
    title: 'From conversation to Jira ticket',
    summary: 'Follow one Anchor CX research project from customer conversations to tickets ready for Jira.',
    minutes: 3,
    steps: [
      {
        title: 'One question, one project',
        body: 'Each research project starts with a question. Anchor CX\'s was: why do customers distrust the health score? This is the Product Funnel, where every project lives. We will follow one from the first conversation to the last ticket.',
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
        title: 'That is the whole path',
        body: 'From a customer\'s own words to a ticket, with the evidence kept at every step. Back on Platform Insights, the same project rolls up with all the others.',
        route: '/projects/:project/stories',
      },
    ],
  },
]

export const tourById = (id: string) => TOURS.find((t) => t.id === id)
