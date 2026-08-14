import type { NextFunction, Request, Response } from 'express'
import type { RowDataPacket } from 'mysql2'
import { getPool } from '../db/pool.js'
import { requireAuth } from './auth.js'

declare global {
  namespace Express {
    interface Request {
      platformAdmin?: boolean
    }
  }
}

/**
 * Requires Bearer JWT for a user with `is_platform_admin = 1`.
 * Does not require the admin's home station to be active (ops must work during incidents).
 */
export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    void (async () => {
      const auth = req.auth
      if (!auth) return
      try {
        const [rows] = await getPool().query<RowDataPacket[]>(
          `SELECT is_platform_admin FROM users WHERE id = ? LIMIT 1`,
          [auth.id],
        )
        const row = (rows as RowDataPacket[])[0]
        if (!row || !Number(row.is_platform_admin)) {
          res.status(403).json({
            error: 'forbidden',
            message: 'Platform admin required',
          })
          return
        }
        req.platformAdmin = true
        next()
      } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'server_error', message: 'Authorization failed' })
      }
    })()
  })
}
