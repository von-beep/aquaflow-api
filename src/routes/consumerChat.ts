import { Router } from 'express'
import type { RowDataPacket } from 'mysql2'
import {
  CHAT_RETENTION_DAYS,
  findOrCreateConversation,
  getConversationForConsumer,
  insertMessage,
  listMessages,
  mapConversation,
  mapMessage,
  markRead,
  purgeExpiredConversations,
  type ConversationRow,
} from '../domain/chat.js'
import { getPool } from '../db/pool.js'
import { badRequest, notFound } from '../lib/http.js'
import { requireConsumerAuth } from '../middleware/auth.js'

type UnreadRow = RowDataPacket & { n: number }
type StationRow = RowDataPacket & { id: string; name: string }

export const consumerChatRouter = Router()

consumerChatRouter.use(requireConsumerAuth)

consumerChatRouter.get('/chat/unread-count', async (req, res) => {
  const consumerId = req.consumer!.id
  await purgeExpiredConversations()
  const [rows] = await getPool().query<UnreadRow[]>(
    `SELECT COUNT(*) AS n
     FROM chat_conversations c
     WHERE c.consumer_user_id = ?
       AND c.last_message_at >= (UTC_TIMESTAMP(3) - INTERVAL ? DAY)
       AND EXISTS (
         SELECT 1 FROM chat_messages m
         WHERE m.conversation_id = c.id
           AND m.sender_type = 'station'
           AND (c.consumer_last_read_at IS NULL OR m.created_at > c.consumer_last_read_at)
       )`,
    [consumerId, CHAT_RETENTION_DAYS],
  )
  res.json({ unreadCount: Number((rows as UnreadRow[])[0]?.n ?? 0) || 0 })
})

consumerChatRouter.get('/chat/conversations', async (req, res) => {
  const consumerId = req.consumer!.id
  await purgeExpiredConversations()
  const [rows] = await getPool().query<ConversationRow[]>(
    `SELECT c.*,
            cu.name AS consumer_name,
            cu.phone AS consumer_phone,
            s.name AS station_name,
            (
              SELECT COUNT(*) FROM chat_messages m
              WHERE m.conversation_id = c.id
                AND m.sender_type = 'station'
                AND (c.consumer_last_read_at IS NULL OR m.created_at > c.consumer_last_read_at)
            ) AS unread_count
     FROM chat_conversations c
     INNER JOIN consumer_users cu ON cu.id = c.consumer_user_id
     INNER JOIN stations s ON s.id = c.station_id
     WHERE c.consumer_user_id = ?
       AND c.last_message_at >= (UTC_TIMESTAMP(3) - INTERVAL ? DAY)
     ORDER BY c.last_message_at DESC
     LIMIT 200`,
    [consumerId, CHAT_RETENTION_DAYS],
  )
  res.json({
    retentionDays: CHAT_RETENTION_DAYS,
    conversations: (rows as ConversationRow[]).map((r) => mapConversation(r)),
  })
})

/** Open or create the single thread for this consumer at a station. */
consumerChatRouter.post('/chat/conversations', async (req, res) => {
  const consumerId = req.consumer!.id
  const stationId =
    typeof req.body?.stationId === 'string' ? req.body.stationId.trim() : ''
  if (!stationId) {
    badRequest(res, 'stationId is required')
    return
  }

  await purgeExpiredConversations()

  const [stationRows] = await getPool().query<StationRow[]>(
    `SELECT id, name FROM stations WHERE id = ? LIMIT 1`,
    [stationId],
  )
  const station = (stationRows as StationRow[])[0]
  if (!station) {
    notFound(res, 'Station')
    return
  }

  const conv = await findOrCreateConversation({
    stationId: station.id,
    consumerUserId: consumerId,
  })
  res.status(201).json({ conversation: mapConversation(conv) })
})

consumerChatRouter.get('/chat/conversations/:id/messages', async (req, res) => {
  const consumerId = req.consumer!.id
  await purgeExpiredConversations()
  const conv = await getConversationForConsumer(
    getPool(),
    req.params.id,
    consumerId,
  )
  if (!conv) {
    notFound(res, 'Conversation')
    return
  }
  await markRead(conv.id, 'consumer')
  const messages = await listMessages(conv.id)
  res.json({
    conversation: mapConversation(conv),
    messages: messages.map(mapMessage),
  })
})

consumerChatRouter.post('/chat/conversations/:id/messages', async (req, res) => {
  const consumerId = req.consumer!.id
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : ''
  if (!body) {
    badRequest(res, 'Message body is required')
    return
  }
  if (body.length > 2000) {
    badRequest(res, 'Message is too long (max 2000 characters)')
    return
  }

  await purgeExpiredConversations()
  const conv = await getConversationForConsumer(
    getPool(),
    req.params.id,
    consumerId,
  )
  if (!conv) {
    notFound(res, 'Conversation')
    return
  }

  const message = await insertMessage({
    conversationId: conv.id,
    senderType: 'consumer',
    senderId: consumerId,
    body,
  })
  res.status(201).json({ message: mapMessage(message) })
})
