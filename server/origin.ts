/** Where a theme was heard: from customers, from the team (CSMs, Support, Sales), or both. A theme with no quotes counts as customers. */
export type Origin = 'customer' | 'team' | 'both'
export const originOf = (customerQuotes: number, teamQuotes: number): Origin => (teamQuotes > 0 ? (customerQuotes > 0 ? 'both' : 'team') : 'customer')
