export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

/** URL-safe slug from a station name; appends short suffix if needed by caller. */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return base || 'station'
}
