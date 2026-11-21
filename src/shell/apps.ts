// The suite's apps and where each one's navigation goes. One config drives the header, the launcher and the narrow-screen menu.
// Platform Insights is the suite home (the page people land on after signing in): it is in the launcher, and also stays a top item of Signal Flow.
import brand from '../../brand/brand.json'

export type AppKey = 'signal-flow' | 'pulse'
export type NavItem = { to: string; label: string; match: (path: string) => boolean }

export type AppDef = {
  key: AppKey
  name: string
  blurb: string
  /** The full-colour icon, for the launcher. */
  icon: string
  items: NavItem[]
  owns: (path: string) => boolean
}

const startsWith = (prefix: string) => (path: string) => path === prefix || path.startsWith(prefix + '/')

export const APPS: Record<AppKey, AppDef> = {
  'signal-flow': {
    key: 'signal-flow',
    name: brand.appName,
    blurb: 'From research to release',
    icon: '/app-icons/signal-flow-128.png',
    items: [
      { to: '/insights/themes', label: 'Platform Insights', match: startsWith('/insights') },
      { to: '/projects', label: 'Projects', match: (p) => startsWith('/projects')(p) || startsWith('/requirements')(p) || startsWith('/launches')(p) },
      { to: '/measure', label: 'Measure', match: startsWith('/measure') },
    ],
    owns: (p) => !startsWith('/pulse')(p),
  },
  pulse: {
    key: 'pulse',
    name: 'Pulse',
    blurb: 'What customers are telling you',
    icon: '/app-icons/pulse-128.png',
    items: [
      { to: '/pulse', label: 'Topics', match: (p) => p === '/pulse' || startsWith('/pulse/topics')(p) },
      { to: '/pulse/signals', label: 'Signals', match: startsWith('/pulse/signals') },
    ],
    owns: startsWith('/pulse'),
  },
}

export const appFor = (path: string): AppDef => (APPS.pulse.owns(path) ? APPS.pulse : APPS['signal-flow'])

/** The suite home: the page people land on after signing in. */
export const HOME = { to: '/insights/themes', label: 'Platform Insights', blurb: 'Everything the suite has learned' }
