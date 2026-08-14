import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import type { Pool, PoolConnection } from 'mysql2/promise'
import { getPool } from '../db/pool.js'
import { uid } from '../lib/ids.js'

/** Conversations with no activity for this many days are deleted. */
export const CHAT_RETENTION_DAYS = 30

export type ChatSenderType = 'consumer' | 'station'

export type ConversationRow = RowDataPacket & {
  id: string
  station_id: string
  consumer_user_id: string
  order_id: string | null
  last_message_at: Date | string
  last_message_preview: string
  consumer_last_read_at: Date | string | null
  station_last_read_at: Date | string | null
  created_at: Date | string
  consumer_name?: string
  consumer_phone?: string
  station_name?: string
  unread_count?: number | string
}

export type MessageRow = RowDataPacket & {
  id: string
  conversation_id: string
  sender_type: ChatSenderType
  sender_id: string
  body: string
  created_at: Date | string
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString()
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function mapConversation(
  r: ConversationRow,
  extras?: {
    consumerName?: string
    consumerPhone?: string
    stationName?: string
    unreadCount?: number
  },
) {
  return {
    id: r.id,
    stationId: r.station_id,
    consumerUserId: r.consumer_user_id,
    orderId: r.order_id ?? null,
    lastMessageAt: toIso(r.last_message_at) ?? new Date().toISOString(),
    lastMessagePreview: r.last_message_preview ?? '',
    consumerLastReadAt: toIso(r.consumer_last_read_at),
    stationLastReadAt: toIso(r.station_last_read_at),
    createdAt: toIso(r.created_at) ?? new Date().toISOString(),
    consumerName: extras?.consumerName ?? r.consumer_name ?? '',
    consumerPhone: extras?.consumerPhone ?? r.consumer_phone ?? '',
    stationName: extras?.stationName ?? r.station_name ?? '',
    unreadCount:
      extras?.unreadCount !== undefined
        ? extras.unreadCount
        : Number(r.unread_count ?? 0),
  }
}

export function mapMessage(r: MessageRow) {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    senderType: r.sender_type,
    senderId: r.sender_id,
    body: r.body,
    createdAt: toIso(r.created_at) ?? new Date().toISOString(),
  }
}

/** Delete conversations (and cascaded messages) past the retention window. */
export async function purgeExpiredConversations(
  pool: Pool | PoolConnection = getPool(),
): Promise<number> {
  const [result] = await pool.query<ResultSetHeader>(
    `DELETE FROM chat_conversations
     WHERE last_message_at < (UTC_TIMESTAMP(3) - INTERVAL ? DAY)`,
    [CHAT_RETENTION_DAYS],
  )
  return result.affectedRows
}

export async function getConversationForStation(
  pool: Pool | PoolConnection,
  conversationId: string,
  stationId: string,
): Promise<ConversationRow | null> {
  const [rows] = await pool.query<ConversationRow[]>(
    `SELECT c.*, cu.name AS consumer_name, cu.phone AS consumer_phone, s.name AS station_name
     FROM chat_conversations c
     INNER JOIN consumer_users cu ON cu.id = c.consumer_user_id
     INNER JOIN stations s ON s.id = c.station_id
     WHERE c.id = ? AND c.station_id = ?
       AND c.last_message_at >= (UTC_TIMESTAMP(3) - INTERVAL ? DAY)
     LIMIT 1`,
    [conversationId, stationId, CHAT_RETENTION_DAYS],
  )
  return (rows as ConversationRow[])[0] ?? null
}

export async function getConversationForConsumer(
  pool: Pool | PoolConnection,
  conversationId: string,
  consumerUserId: string,
): Promise<ConversationRow | null> {
  const [rows] = await pool.query<ConversationRow[]>(
    `SELECT c.*, cu.name AS consumer_name, cu.phone AS consumer_phone, s.name AS station_name
     FROM chat_conversations c
     INNER JOIN consumer_users cu ON cu.id = c.consumer_user_id
     INNER JOIN stations s ON s.id = c.station_id
     WHERE c.id = ? AND c.consumer_user_id = ?
       AND c.last_message_at >= (UTC_TIMESTAMP(3) - INTERVAL ? DAY)
     LIMIT 1`,
    [conversationId, consumerUserId, CHAT_RETENTION_DAYS],
  )
  return (rows as ConversationRow[])[0] ?? null
}

export async function findOrCreateConversation(input: {
  stationId: string
  consumerUserId: string
}): Promise<ConversationRow> {
  const pool = getPool()
  await purgeExpiredConversations(pool)

  const [existing] = await pool.query<ConversationRow[]>(
    `SELECT c.*, cu.name AS consumer_name, cu.phone AS consumer_phone, s.name AS station_name
     FROM chat_conversations c
     INNER JOIN consumer_users cu ON cu.id = c.consumer_user_id
     INNER JOIN stations s ON s.id = c.station_id
     WHERE c.station_id = ? AND c.consumer_user_id = ?
     LIMIT 1`,
    [input.stationId, input.consumerUserId],
  )
  const found = (existing as ConversationRow[])[0]
  if (found) return found

  const id = uid()
  await pool.query(
    `INSERT INTO chat_conversations
       (id, station_id, consumer_user_id, order_id, last_message_at, last_message_preview)
     VALUES (?, ?, ?, NULL, UTC_TIMESTAMP(3), '')`,
    [id, input.stationId, input.consumerUserId],
  )

  const [rows] = await pool.query<ConversationRow[]>(
    `SELECT c.*, cu.name AS consumer_name, cu.phone AS consumer_phone, s.name AS station_name
     FROM chat_conversations c
     INNER JOIN consumer_users cu ON cu.id = c.consumer_user_id
     INNER JOIN stations s ON s.id = c.station_id
     WHERE c.id = ?
     LIMIT 1`,
    [id],
  )
  return (rows as ConversationRow[])[0]!
}

export async function insertMessage(input: {
  conversationId: string
  senderType: ChatSenderType
  senderId: string
  body: string
}): Promise<MessageRow> {
  const pool = getPool()
  const id = uid()
  const preview = input.body.trim().slice(0, 240)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query(
      `INSERT INTO chat_messages (id, conversation_id, sender_type, sender_id, body)
       VALUES (?, ?, ?, ?, ?)`,
      [id, input.conversationId, input.senderType, input.senderId, input.body.trim()],
    )
    if (input.senderType === 'consumer') {
      await conn.query(
        `UPDATE chat_conversations
         SET last_message_at = UTC_TIMESTAMP(3),
             last_message_preview = ?,
             consumer_last_read_at = UTC_TIMESTAMP(3),
             updated_at = UTC_TIMESTAMP(3)
         WHERE id = ?`,
        [preview, input.conversationId],
      )
    } else {
      await conn.query(
        `UPDATE chat_conversations
         SET last_message_at = UTC_TIMESTAMP(3),
             last_message_preview = ?,
             station_last_read_at = UTC_TIMESTAMP(3),
             updated_at = UTC_TIMESTAMP(3)
         WHERE id = ?`,
        [preview, input.conversationId],
      )
    }
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }

  const [rows] = await pool.query<MessageRow[]>(
    `SELECT id, conversation_id, sender_type, sender_id, body, created_at
     FROM chat_messages WHERE id = ? LIMIT 1`,
    [id],
  )
  return (rows as MessageRow[])[0]!
}

export async function listMessages(
  conversationId: string,
): Promise<MessageRow[]> {
  const [rows] = await getPool().query<MessageRow[]>(
    `SELECT id, conversation_id, sender_type, sender_id, body, created_at
     FROM chat_messages
     WHERE conversation_id = ?
     ORDER BY created_at ASC
     LIMIT 500`,
    [conversationId],
  )
  return rows as MessageRow[]
}

export async function markRead(
  conversationId: string,
  side: 'consumer' | 'station',
): Promise<void> {
  if (side === 'consumer') {
    await getPool().query(
      `UPDATE chat_conversations
       SET consumer_last_read_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
       WHERE id = ?`,
      [conversationId],
    )
    return
  }
  await getPool().query(
    `UPDATE chat_conversations
     SET station_last_read_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
     WHERE id = ?`,
    [conversationId],
  )
}
