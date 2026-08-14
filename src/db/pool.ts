import 'dotenv/config'
import { createPool, type Pool, type PoolOptions } from 'mysql2/promise'

function parseDatabaseUrl(url: string): PoolOptions {
  const parsed = new URL(url)
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
  }
}

export function loadDbConfig(): PoolOptions {
  if (process.env.DATABASE_URL) {
    return parseDatabaseUrl(process.env.DATABASE_URL)
  }
  return {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'aquaflow',
    password: process.env.DB_PASSWORD ?? 'aquaflow',
    database: process.env.DB_NAME ?? 'aquaflow',
  }
}

let pool: Pool | null = null

export function getPool(): Pool {
  if (!pool) {
    pool = createPool({
      ...loadDbConfig(),
      waitForConnections: true,
      connectionLimit: 10,
      multipleStatements: true,
    })
  }
  return pool
}

export async function pingDb(): Promise<boolean> {
  const p = getPool()
  const conn = await p.getConnection()
  try {
    await conn.ping()
    return true
  } finally {
    conn.release()
  }
}

/** Retry until MySQL accepts connections (e.g. Docker still starting). */
export async function waitForDb(options?: {
  attempts?: number
  delayMs?: number
}): Promise<void> {
  const attempts = options?.attempts ?? 30
  const delayMs = options?.delayMs ?? 1000
  let lastError: unknown

  for (let i = 1; i <= attempts; i++) {
    try {
      await pingDb()
      if (i > 1) console.log(`Database ready after ${i} attempt(s)`)
      return
    } catch (err) {
      lastError = err
      console.log(`Waiting for database… (${i}/${attempts})`)
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Database did not become ready in time')
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
