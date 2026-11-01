export function compareClassNames(a: string, b: string): number {
  return a.localeCompare(b, 'tr', { numeric: true })
}
