// Static content for the Whirl app prototype, adapted from the original
// Design Component (Whirl App.dc.html) into plain data consumed by React views.

export const PROVENANCE = {
  config: { label: 'From config' },
  confirmed: { label: 'Confirmed' },
  inferred: { label: 'Inferred' },
};

export const NAV_ITEMS = [
  { key: 'workspace', label: 'Change workspace' },
  { key: 'knowledge', label: 'Knowledge base' },
  { key: 'graph', label: 'Integration graph' },
  { key: 'packets', label: 'Review packets' },
];

export const DOMAINS = [
  { name: 'Marketing', count: 3 },
  { name: 'Sales', count: 7 },
  { name: 'Service', count: 4 },
  { name: 'HR', count: 2, active: true },
  { name: 'Finance', count: 5 },
];

export const STAGES_BASE = [
  { kind: 'Agent', name: 'Research', status: 'Done · 6 min', state: 'done' },
  { kind: 'Agent', name: 'Requirements', status: 'Done · 11 reqs', state: 'done' },
  { kind: 'Agent', name: 'Design', status: 'Done · 8 changes', state: 'done' },
  { kind: 'Human', name: 'Checkpoint', state: 'checkpoint' },
  { kind: 'Agent', name: 'Coding', state: 'coding' },
  { kind: 'Agent', name: 'Testing', status: 'Queued', state: 'queued' },
];

export const SPEC_ROWS = [
  { sys: 'Workday', change: 'Add Contractor value to Worker Type', provenance: 'config' },
  { sys: 'Workday', change: 'New Hire: Contractor sub-process, skipping cost center approval', provenance: 'inferred' },
  { sys: 'Okta', change: 'Map employeeType = Contractor to Contractors-Default group', provenance: 'config' },
  { sys: 'ServiceNow', change: 'Contractor onboarding variant with VDI instead of laptop', provenance: 'confirmed' },
  { sys: 'NetSuite', change: 'Create vendor record on contractor hire', provenance: 'confirmed' },
];

export const ENTITIES = [
  { sys: 'Workday', type: 'Field', name: 'Worker Type', provenance: 'config' },
  { sys: 'Workday', type: 'Approval chain', name: 'New hire requisition', provenance: 'inferred' },
  { sys: 'Okta', type: 'Rule', name: 'employeeType mapping', provenance: 'config' },
  { sys: 'ServiceNow', type: 'Catalog item', name: 'New hire onboarding', provenance: 'config' },
  { sys: 'NetSuite', type: 'Record', name: 'Vendor (1099)', provenance: 'confirmed' },
];

export const CONNECTORS = [
  { name: 'Workday', when: '4 min ago', status: 'ok' },
  { name: 'Okta', when: '9 min ago', status: 'ok' },
  { name: 'ServiceNow', when: '22 min ago', status: 'ok' },
  { name: 'NetSuite', when: '3 h ago', status: 'warn' },
];

export const HISTORY_BASE = [
  { what: 'Step 2 SLA changed from 3 to 2 business days', who: 'Detected in config', when: 'Sep 18' },
  { what: 'Step 4 integration moved to WD-OUT-07', who: 'Detected in config', when: 'Aug 29' },
  { what: 'Vendor sync behaviour confirmed', who: 'Dana K. · Finance', when: 'Aug 21' },
  { what: 'Page created from Workday BP', who: 'Research agent', when: 'Jul 02' },
];

export const LENS_NAMES = ['All teams', 'HR', 'IT', 'Finance'];

export const ALL_FACTS = [
  { n: 1, text: 'Hiring manager submits the requisition with position, cost center and worker type.', source: 'Workday BP step 1', provenance: 'config', lenses: [0, 1] },
  { n: 2, text: 'HR partner reviews job profile and compensation grade within 2 business days.', source: 'Workday BP step 2 · SLA from HR policy doc', provenance: 'confirmed', lenses: [0, 1] },
  { n: 3, text: 'Cost center owner approves if the role is budgeted headcount. Contractors skip this step.', source: 'Condition on step 3 matches Employee only; no contractor history', provenance: 'inferred', ask: true, lenses: [0, 1, 3] },
  { n: 4, text: 'Approval fires an event to ServiceNow onboarding and Okta provisioning.', source: 'Integration WD-OUT-07', provenance: 'config', lenses: [0, 2] },
  { n: 5, text: 'Finance creates a vendor record in NetSuite for 1099 workers.', source: 'NetSuite vendor sync script', provenance: 'confirmed', lenses: [0, 3] },
];

export const LANES = ['Workday', 'Okta', 'ServiceNow', 'NetSuite'];
export const LANE_X = [16, 240, 464, 688];

export const NODES = [
  { id: 'wt', lane: 0, y: 64, type: 'Field', name: 'Worker Type', source: true, provenance: 'config', impact: 'The field being changed. Adding a Contractor value fans out to three downstream systems.', evidence: 'Workday tenant config, field WRK_TYPE, 3 existing values.' },
  { id: 'bp', lane: 0, y: 224, type: 'Business process', name: 'Hire: Contractor sub-process', provenance: 'config', impact: 'New sub-process needed. Triggered when Worker Type = Contractor.', evidence: 'Hire BP definition, condition rules on step 2.' },
  { id: 'ap', lane: 0, y: 384, type: 'Approval step', name: 'Cost center owner approval', indirect: true, provenance: 'inferred', impact: "Whirl infers contractors skip this step because the existing rule only matches Employee. Needs confirmation.", evidence: 'Inferred from 212 completed hires in the last 12 months; no contractor records exist yet.' },
  { id: 'pr', lane: 1, y: 64, type: 'Provisioning rule', name: 'Map employeeType attribute', provenance: 'config', impact: 'Rule must accept the new value or contractors will be provisioned as employees.', evidence: 'Okta profile mapping, Workday → Okta, attribute employeeType.' },
  { id: 'gr', lane: 1, y: 224, type: 'Group', name: 'Contractors-Default', indirect: true, provenance: 'confirmed', impact: 'Two hops away. Group membership drives app access; confirm contractor app list.', evidence: 'Confirmed by IT Security, Aug 14.' },
  { id: 'ci', lane: 2, y: 144, type: 'Catalog item', name: 'New hire onboarding', provenance: 'config', impact: 'Triggered on hire. Needs a Contractor variant with reduced equipment.', evidence: 'Flow Designer trigger on inbound Workday event.' },
  { id: 'lp', lane: 2, y: 304, type: 'Workflow', name: 'Laptop request', indirect: true, provenance: 'confirmed', impact: 'Two hops away. Contractors receive VDI access, not hardware.', evidence: 'Confirmed by IT Ops, Jul 30.' },
  { id: 'vr', lane: 3, y: 384, type: 'Record', name: 'Vendor record (1099)', provenance: 'config', impact: 'Contractors are paid as vendors. A vendor record must be created on hire.', evidence: 'NetSuite integration script, vendor sync from Workday.' },
  { id: 'ar', lane: 3, y: 544, type: 'Approval routing', name: 'AP invoice approval', indirect: true, provenance: 'config', impact: 'Two hops away. Routing uses department from Workday; no change expected.', evidence: 'NetSuite approval rule AP-04.' },
];

export const EDGES = [
  ['wt', 'pr', 'data'], ['wt', 'bp', 'trigger'], ['bp', 'ap', 'approval'],
  ['pr', 'gr', 'data'], ['wt', 'ci', 'trigger'], ['ci', 'lp', 'trigger'],
  ['wt', 'vr', 'data'], ['vr', 'ar', 'approval'],
];

export const EDGE_DASH = { data: '0', trigger: '7 5', approval: '1 6' };

export const SYS_TABS = [
  { name: 'Workday', count: 3 },
  { name: 'Okta', count: 2 },
  { name: 'ServiceNow', count: 2 },
  { name: 'NetSuite', count: 1 },
];

export const DIFFS = [
  {
    title: 'Worker Type · allowed values',
    provenance: 'config',
    evidence: 'Tenant config field WRK_TYPE, read 09:38.',
    lines: [
      { sign: ' ', text: 'Employee' },
      { sign: ' ', text: 'Intern' },
      { sign: '+', text: 'Contractor' },
    ],
  },
  {
    title: 'Hire BP · step 3 condition',
    provenance: 'inferred',
    evidence: 'Condition matches Employee only. 212 past hires, 0 contractors.',
    comment: 'Contractors over 6 months still need cost center sign-off. Can we add a duration check?',
    lines: [
      { sign: '-', text: 'IF worker_type = "Employee" THEN require cost_center_owner' },
      { sign: '+', text: 'IF worker_type IN ("Employee") THEN require cost_center_owner' },
      { sign: '+', text: 'IF worker_type = "Contractor" THEN skip' },
    ],
  },
];

export const AUDIT_BASE = [
  { what: 'Design agent generated packet v3', when: '09:42', snap: 'ctx-7f3a' },
  { what: 'Priya R. commented on step 3 condition', when: '09:55', snap: 'ctx-7f3a' },
  { what: 'Requirements agent run', when: '09:21', snap: 'ctx-7f2c' },
  { what: 'Research agent run', when: '09:04', snap: 'ctx-7f2c' },
];
