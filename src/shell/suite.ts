// The Pulse app and the app switcher are held back from every viewer until the Pulse pages are more complete (decided 2026-11-21).
// Set VITE_SHOW_SUITE=true at build time (the browser tests do) to bring back the switcher in the header and the "Heard in Pulse" strip
// on Platform Insights; the Pulse pages and routes stay in place.
export const SHOW_SUITE = import.meta.env.VITE_SHOW_SUITE === 'true'
