import 'dotenv/config'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { closePool, getPool, waitForDb } from './pool.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations')

async function ensureMigrationsTable(): Promise<void> {
  const pool = getPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

async function appliedIds(): Promise<Set<string>> {
  const pool = getPool()
  const [rows] = await pool.query('SELECT id FROM schema_migrations ORDER BY id')
  return new Set((rows as { id: string }[]).map((r) => r.id))
}

async function migrate(): Promise<void> {
  await waitForDb()
  await ensureMigrationsTable()
  const applied = await appliedIds()
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const pool = getPool()

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip  ${file}`)
      continue
    }
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8')
    // DDL auto-commits in MySQL — do not wrap the whole file in a transaction.
    await pool.query(sql)
    await pool.query('INSERT INTO schema_migrations (id) VALUES (?)', [file])
    console.log(`apply ${file}`)
  }
}

migrate()
  .then(async () => {
    console.log('Migrations complete')
    await closePool()
  })
  .catch(async (err: unknown) => {
    console.error(err)
    await closePool()
    process.exit(1)
  })
