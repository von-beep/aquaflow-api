import { Router } from 'express'
import { pingDb } from '../db/pool.js'

export const healthRouter = Router()

healthRouter.get('/health', async (_req, res) => {
  try {
    const db = await pingDb()
    res.json({ ok: true, db })
  } catch {
    res.status(503).json({ ok: false, db: false })
  }
})
