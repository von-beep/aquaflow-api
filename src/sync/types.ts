export const ENTITY_COLLECTIONS = [
  'products',
  'customers',
  'riders',
  'deliveries',
  'utang',
  'payments',
] as const

export const SINGLETON_COLLECTIONS = ['settings', 'inventory'] as const

export const SYNC_COLLECTIONS = [...ENTITY_COLLECTIONS, ...SINGLETON_COLLECTIONS] as const

export type EntityCollection = (typeof ENTITY_COLLECTIONS)[number]
export type SingletonCollection = (typeof SINGLETON_COLLECTIONS)[number]
export type SyncCollection = (typeof SYNC_COLLECTIONS)[number]

export function isEntityCollection(c: string): c is EntityCollection {
  return (ENTITY_COLLECTIONS as readonly string[]).includes(c)
}

export function isSingletonCollection(c: string): c is SingletonCollection {
  return (SINGLETON_COLLECTIONS as readonly string[]).includes(c)
}

export function isSyncCollection(c: string): c is SyncCollection {
  return (SYNC_COLLECTIONS as readonly string[]).includes(c)
}

export function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString()
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function parseSince(since: unknown): Date {
  if (since == null || since === '') {
    return new Date(0)
  }
  if (typeof since !== 'string') {
    throw new Error('since must be an ISO-8601 string')
  }
  const d = new Date(since)
  if (Number.isNaN(d.getTime())) {
    throw new Error('since must be a valid ISO-8601 timestamp')
  }
  return d
}
