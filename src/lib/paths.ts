/** Normalize folder roots so Windows path casing / slashes still match. */
export function sameProjectRoot(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a || !b) return false
  const norm = (p: string): string =>
    p.replace(/\//g, '\\').replace(/[\\/]+$/, '').toLowerCase()
  return norm(a) === norm(b)
}
