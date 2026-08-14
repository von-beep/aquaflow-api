import jwt, { type SignOptions } from 'jsonwebtoken'

export const JWT_EXPIRES_IN = '7d' as const

export type StationRole = 'owner' | 'staff' | 'rider'

export type StationJwtPayload = {
  sub: string
  stationId: string
  kind?: 'station'
  role?: StationRole
  riderId?: string
}

export type ConsumerJwtPayload = {
  sub: string
  kind: 'consumer'
}

export type JwtPayload = StationJwtPayload | ConsumerJwtPayload

function secret(): string {
  const s = process.env.JWT_SECRET
  if (!s) {
    throw new Error('JWT_SECRET is not set')
  }
  return s
}

export function signToken(payload: JwtPayload): string {
  const options: SignOptions = { expiresIn: JWT_EXPIRES_IN }
  return jwt.sign(payload, secret(), options)
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, secret())
  if (typeof decoded !== 'object' || decoded === null) {
    throw new Error('Invalid token payload')
  }
  const sub = (decoded as { sub?: unknown }).sub
  const kind = (decoded as { kind?: unknown }).kind
  const stationId = (decoded as { stationId?: unknown }).stationId
  const roleRaw = (decoded as { role?: unknown }).role
  const riderIdRaw = (decoded as { riderId?: unknown }).riderId

  if (typeof sub !== 'string') {
    throw new Error('Invalid token claims')
  }

  if (kind === 'consumer') {
    return { sub, kind: 'consumer' }
  }

  if (typeof stationId !== 'string') {
    throw new Error('Invalid token claims')
  }

  const role: StationRole | undefined =
    roleRaw === 'owner' || roleRaw === 'staff' || roleRaw === 'rider'
      ? roleRaw
      : undefined
  const riderId = typeof riderIdRaw === 'string' && riderIdRaw ? riderIdRaw : undefined

  return { sub, stationId, kind: 'station', role, riderId }
}

export function isConsumerPayload(p: JwtPayload): p is ConsumerJwtPayload {
  return p.kind === 'consumer'
}

export function isStationPayload(p: JwtPayload): p is StationJwtPayload {
  return p.kind !== 'consumer' && typeof (p as StationJwtPayload).stationId === 'string'
}
