import { uid } from '../lib/ids.js'

const XENDIT_BASE = (process.env.XENDIT_API_BASE ?? 'https://api.xendit.co').replace(/\/$/, '')
const API_VERSION = process.env.XENDIT_API_VERSION ?? '2026-01-01'

export type XenditSession = {
  payment_session_id?: string
  payment_link_url?: string
  reference_id?: string
  status?: string
  [key: string]: unknown
}

export class XenditError extends Error {
  status: number
  body: unknown
  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

export function isXenditConfigured(): boolean {
  return Boolean(process.env.XENDIT_SECRET_KEY?.trim())
}

function authHeader(): string {
  const key = process.env.XENDIT_SECRET_KEY?.trim()
  if (!key) throw new Error('XENDIT_SECRET_KEY is not set')
  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`
}

async function xenditFetch<T>(path: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', authHeader())
  headers.set('Content-Type', 'application/json')
  headers.set('api-version', API_VERSION)

  const res = await fetch(`${XENDIT_BASE}${path}`, { ...init, headers })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  if (!res.ok) {
    const msg =
      body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : `Xendit HTTP ${res.status}`
    throw new XenditError(msg, res.status, body)
  }
  return body as T
}

export type CreateSubscriptionSessionInput = {
  stationId: string
  stationName: string
  ownerEmail: string
  amount: number
  currency: string
  country: string
  successUrl: string
  cancelUrl: string
  planCode: string
}

export async function createSubscriptionSession(
  input: CreateSubscriptionSessionInput,
): Promise<{ session: XenditSession; checkoutRef: string; customerRef: string }> {
  const checkoutRef = `${input.stationId}:${uid()}`
  const customerRef = `station_${input.stationId}`
  const anchor = new Date()
  // Xendit: max day-of-month for anchor is 28
  if (anchor.getUTCDate() > 28) {
    anchor.setUTCDate(28)
  }

  const given = input.stationName.trim().slice(0, 50) || 'Station'
  const payload = {
    reference_id: checkoutRef,
    session_type: 'SUBSCRIPTION',
    mode: 'PAYMENT_LINK',
    amount: String(input.amount),
    currency: input.currency,
    country: input.country,
    locale: 'en',
    description: `AquaFlow ${input.planCode} — ${input.stationName}`.slice(0, 255),
    customer: {
      reference_id: customerRef,
      type: 'INDIVIDUAL',
      email: input.ownerEmail,
      individual_detail: {
        given_names: given.slice(0, 50),
        surname: 'Owner',
      },
    },
    subscription: {
      schedule: {
        interval: 'MONTH',
        interval_count: '1',
        anchor_date: anchor.toISOString(),
        retry_interval: 'DAY',
        retry_interval_count: '1',
        total_retry: '3',
      },
      failed_cycle_action: 'STOP',
    },
    success_return_url: input.successUrl,
    cancel_return_url: input.cancelUrl,
  }

  const session = await xenditFetch<XenditSession>('/sessions', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

  return { session, checkoutRef, customerRef }
}

export async function deactivateRecurringPlan(planId: string): Promise<unknown> {
  return xenditFetch(`/recurring/plans/${encodeURIComponent(planId)}/deactivate`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export function verifyXenditCallbackToken(headerValue: string | undefined): boolean {
  const expected = process.env.XENDIT_CALLBACK_TOKEN?.trim()
  if (!expected) {
    // In local/dev without token configured, reject in production-like setups
    return process.env.NODE_ENV !== 'production'
  }
  return Boolean(headerValue && headerValue === expected)
}
