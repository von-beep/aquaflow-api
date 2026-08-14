import { Router } from 'express'
import { getPool } from '../db/pool.js'
import { badRequest, stationId } from '../lib/http.js'
import { requireSyncEntitlement } from '../middleware/requireSyncEntitlement.js'
import { pullChanges } from '../sync/pull.js'
import { pushMutations, type PushMutation } from '../sync/push.js'
import { isSyncCollection, parseSince } from '../sync/types.js'

export const syncRouter = Router()

syncRouter.use(requireSyncEntitlement)

syncRouter.post('/pull', async (req, res) => {
  const sid = stationId(req)
  let since: Date
  try {
    since = parseSince(req.body?.since)
  } catch (err) {
    badRequest(res, err instanceof Error ? err.message : 'invalid since')
    return
  }

  const result = await pullChanges(getPool(), sid, since)
  res.json(result)
})

syncRouter.post('/push', async (req, res) => {
  const sid = stationId(req)
  const raw = req.body?.mutations
  if (!Array.isArray(raw)) {
    badRequest(res, 'mutations must be an array')
    return
  }

  const mutations: PushMutation[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      badRequest(res, 'each mutation must be an object')
      return
    }
    const collection = String(item.collection ?? '')
    if (!isSyncCollection(collection)) {
      badRequest(res, `unknown collection: ${collection}`)
      return
    }
    const id = String(item.id ?? '')
    const op = item.op
    const updatedAt = String(item.updatedAt ?? '')
    if (!id || (op !== 'upsert' && op !== 'delete') || !updatedAt) {
      badRequest(res, 'mutation requires id, op (upsert|delete), and updatedAt')
      return
    }
    mutations.push({
      collection,
      id,
      op,
      updatedAt,
      data: item.data && typeof item.data === 'object' ? item.data : undefined,
    })
  }

  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()
    const result = await pushMutations(conn, sid, mutations)
    await conn.commit()
    res.json(result)
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
})
