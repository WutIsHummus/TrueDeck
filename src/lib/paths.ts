/** Normalize folder roots so Windows path casing / slashes still match. */
export function projectRootKey(root: string | null | undefined): string {
  if (!root) return ''
  return root.replace(/\//g, '\\').replace(/[\\/]+$/, '').toLowerCase()
}

export function sameProjectRoot(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a || !b) return false
  return projectRootKey(a) === projectRootKey(b)
}
