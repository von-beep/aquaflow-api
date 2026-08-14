import { Router } from 'express'
import type { RowDataPacket } from 'mysql2'
import {
  CHAT_RETENTION_DAYS,
  getConversationForStation,
  insertMessage,
  listMessages,
  mapConversation,
  mapMessage,
  markRead,
  purgeExpiredConversations,
  type ConversationRow,
} from '../domain/chat.js'
import { getPool } from '../db/pool.js'
import { badRequest, notFound, stationId } from '../lib/http.js'

type UnreadRow = RowDataPacket & { n: number }

export const chatRouter = Router()

chatRouter.get('/unread-count', async (req, res) => {
  const sid = stationId(req)
  await purgeExpiredConversations()
  const [rows] = await getPool().query<UnreadRow[]>(
    `SELECT COUNT(*) AS n
     FROM chat_conversations c
     WHERE c.station_id = ?
       AND c.last_message_at >= (UTC_TIMESTAMP(3) - INTERVAL ? DAY)
       AND EXISTS (
         SELECT 1 FROM chat_messages m
         WHERE m.conversation_id = c.id
           AND m.sender_type = 'consumer'
           AND (c.station_last_read_at IS NULL OR m.created_at > c.station_last_read_at)
       )`,
    [sid, CHAT_RETENTION_DAYS],
  )
  res.json({ unreadCount: Number((rows as UnreadRow[])[0]?.n ?? 0) || 0 })
})

chatRouter.get('/conversations', async (req, res) => {
  const sid = stationId(req)
  await purgeExpiredConversations()
  const [rows] = await getPool().query<ConversationRow[]>(
    `SELECT c.*,
            cu.name AS consumer_name,
            cu.phone AS consumer_phone,
            s.name AS station_name,
            (
              SELECT COUNT(*) FROM chat_messages m
              WHERE m.conversation_id = c.id
                AND m.sender_type = 'consumer'
                AND (c.station_last_read_at IS NULL OR m.created_at > c.station_last_read_at)
            ) AS unread_count
     FROM chat_conversations c
     INNER JOIN consumer_users cu ON cu.id = c.consumer_user_id
     INNER JOIN stations s ON s.id = c.station_id
     WHERE c.station_id = ?
       AND c.last_message_at >= (UTC_TIMESTAMP(3) - INTERVAL ? DAY)
     ORDER BY c.last_message_at DESC
     LIMIT 200`,
    [sid, CHAT_RETENTION_DAYS],
  )
  res.json({
    retentionDays: CHAT_RETENTION_DAYS,
    conversations: (rows as ConversationRow[]).map((r) => mapConversation(r)),
  })
})

chatRouter.get('/conversations/:id/messages', async (req, res) => {
  const sid = stationId(req)
  await purgeExpiredConversations()
  const conv = await getConversationForStation(getPool(), req.params.id, sid)
  if (!conv) {
    notFound(res, 'Conversation')
    return
  }
  await markRead(conv.id, 'station')
  const messages = await listMessages(conv.id)
  res.json({
    conversation: mapConversation(conv),
    messages: messages.map(mapMessage),
  })
})

chatRouter.post('/conversations/:id/messages', async (req, res) => {
  const sid = stationId(req)
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
  const conv = await getConversationForStation(getPool(), req.params.id, sid)
  if (!conv) {
    notFound(res, 'Conversation')
    return
  }

  const message = await insertMessage({
    conversationId: conv.id,
    senderType: 'station',
    senderId: req.auth!.id,
    body,
  })
  res.status(201).json({ message: mapMessage(message) })
})
