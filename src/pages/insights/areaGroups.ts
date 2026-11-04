export type AreaRef = { id: string; name: string } | null

/** Items divided by experience category, in the order each area first appears, with the ones that have none last as "Unassigned". */
export function groupByArea<T extends { area: AreaRef }>(items: T[]): { key: string; name: string; items: T[] }[] {
  const by = new Map<string, { key: string; name: string; items: T[] }>()
  for (const item of items) {
    const key = item.area?.id ?? 'unassigned'
    const group = by.get(key) ?? { key, name: item.area?.name ?? 'Unassigned', items: [] }
    group.items.push(item)
    by.set(key, group)
  }
  return [...by.values()].sort((a, b) => Number(a.key === 'unassigned') - Number(b.key === 'unassigned'))
}
