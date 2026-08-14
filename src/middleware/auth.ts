import type { NextFunction, Request, Response } from 'express'
import {
  isConsumerPayload,
  isStationPayload,
  verifyToken,
  type ConsumerJwtPayload,
  type StationJwtPayload,
  type StationRole,
} from '../lib/jwt.js'

export type AuthUser = {
  id: string
  stationId: string
  role: StationRole
  riderId: string | null
}

export type ConsumerAuth = {
  id: string
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthUser
      consumer?: ConsumerAuth
    }
  }
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token || null
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = bearerToken(req)
  if (!token) {
    res.status(401).json({
      error: 'unauthorized',
      message: 'Missing or invalid Authorization header (expected Bearer token)',
    })
    return
  }

  try {
    const payload = verifyToken(token)
    if (!isStationPayload(payload)) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Station account required',
      })
      return
    }
    const station: StationJwtPayload = payload
    req.auth = {
      id: station.sub,
      stationId: station.stationId,
      role: station.role ?? 'staff',
      riderId: station.riderId ?? null,
    }
    next()
  } catch {
    res.status(401).json({
      error: 'unauthorized',
      message: 'Invalid or expired token',
    })
  }
}

/** Owner/staff station console — blocks delivery rider JWTs. */
export function requireOwnerOrStaff(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.auth) {
    res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' })
    return
  }
  if (req.auth.role === 'rider') {
    res.status(403).json({
      error: 'forbidden',
      message: 'Rider accounts use the /rider app',
    })
    return
  }
  next()
}

/** Field rider app — requires role=rider and riderId. */
export function requireRider(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: 'unauthorized', message: 'Not authenticated' })
    return
  }
  if (req.auth.role !== 'rider' || !req.auth.riderId) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Delivery rider account required',
    })
    return
  }
  next()
}

export function requireConsumerAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const token = bearerToken(req)
  if (!token) {
    res.status(401).json({
      error: 'unauthorized',
      message: 'Sign in required to place or view orders',
    })
    return
  }

  try {
    const payload = verifyToken(token)
    if (!isConsumerPayload(payload)) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Customer account required',
      })
      return
    }
    const consumer: ConsumerJwtPayload = payload
    req.consumer = { id: consumer.sub }
    next()
  } catch {
    res.status(401).json({
      error: 'unauthorized',
      message: 'Invalid or expired token',
    })
  }
}

/** Cross-tenant access (when resource station_id ≠ JWT stationId). */
export function forbidCrossTenant(res: Response): void {
  res.status(403).json({
    error: 'forbidden',
    message: 'Access to another station is not allowed',
  })
}
