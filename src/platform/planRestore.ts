/** Restore plan_status after platform unsuspend. */
export function planStatusAfterUnsuspend(
  previous: string | null | undefined,
): 'trial' | 'active' {
  if (previous === 'active') return 'active'
  return 'trial'
}

export const PLATFORM_STATION_ID = 's_platform'
