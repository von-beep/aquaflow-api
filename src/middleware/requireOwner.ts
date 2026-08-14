import type { NextFunction, Request, Response } from 'express'
import type { RowDataPacket } from 'mysql2'
import { getPool } from '../db/pool.js'
import { requireAuth } from './auth.js'

export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    void (async () => {
      const auth = req.auth
      if (!auth) return
      try {
        const [rows] = await getPool().query<RowDataPacket[]>(
          `SELECT role FROM users WHERE id = ? AND station_id = ? LIMIT 1`,
          [auth.id, auth.stationId],
        )
        const role = (rows as RowDataPacket[])[0]?.role
        if (role !== 'owner') {
          res.status(403).json({
            error: 'forbidden',
            message: 'Owner role required',
          })
          return
        }
        next()
      } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'server_error', message: 'Authorization failed' })
      }
    })()
  })
}
