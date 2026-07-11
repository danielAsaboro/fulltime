/** Worker cursor pages are newest-first; room UI is oldest-first. */
export function chronologicalPage<T>(items: readonly T[] | null | undefined): T[] {
  return items ? [...items].reverse() : [];
}
