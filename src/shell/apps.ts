// The suite's apps and where each one's navigation goes. One config drives the header, the launcher and the narrow-screen menu.
// Platform Insights is Signal Flow's home (the page people land on after signing in, and on switching to Signal Flow from another app): it is the first item of Signal Flow, not a card of its own in the launcher.
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
  /** Whether the app has a guided tour. The header's Take a tour button, and the welcome screen a read-only visitor sees first, are only for an app that does. */
  hasTour: boolean
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
    hasTour: true,
    owns: (p) => !startsWith('/pulse')(p),
  },
  pulse: {
    key: 'pulse',
    name: 'Pulse',
    blurb: 'What customers are telling you',
    icon: '/app-icons/pulse-128.png',
    items: [
      { to: '/pulse', label: 'Topics', match: (p) => p === '/pulse' || startsWith('/pulse/topics')(p) },
    ],
    hasTour: true,
    owns: startsWith('/pulse'),
  },
}

export const appFor = (path: string): AppDef => (APPS.pulse.owns(path) ? APPS.pulse : APPS['signal-flow'])

/** Where people land after signing in: Platform Insights, Signal Flow's home. Not an app of its own, so it has no launcher card. */
export const HOME = { to: '/insights/themes', label: 'Platform Insights', blurb: 'Everything the suite has learned', icon: '/app-icons/platform-insights-128.png' }
