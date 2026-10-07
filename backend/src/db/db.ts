// Thin Postgres access: parameterised queries, camelCase rows, transactions and the schema migration.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

// NUMERIC stays a string for decimal.js; BIGINT fits in a JS number for our ids and client ids.
pg.types.setTypeParser(20, Number)

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T>
  maybeOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>
}

class Runner implements Queryable {
  constructor(private readonly executor: pg.Pool | pg.PoolClient) {}

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.executor.query(sql, params)
    return result.rows.map(camelize) as T[]
  }

  async one<T>(sql: string, params: unknown[] = []): Promise<T> {
    const row = await this.maybeOne<T>(sql, params)
    if (row === null) throw new Error(`Expected one row: ${sql.slice(0, 80)}`)
    return row
  }

  async maybeOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params)
    return rows[0] ?? null
  }
}

export class Db extends Runner {
  readonly pool: pg.Pool

  constructor(connectionString: string) {
    const pool = new pg.Pool({ connectionString, max: 5 })
    super(pool)
    this.pool = pool
  }

  async tx<T>(work: (q: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await work(new Runner(client))
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async migrate(): Promise<void> {
    const sql = readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8')
    await this.pool.query(sql)
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

/** `UPDATE table SET a = $1, b = $2 WHERE id = $3` from a camelCase patch. */
export function updateSql(table: string, patch: Record<string, unknown>, idColumn = 'id'): { sql: string; params: unknown[] } {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined)
  if (!entries.length) throw new Error(`Empty patch for ${table}`)
  const assignments = entries.map(([key], i) => `${snake(key)} = $${i + 1}`)
  const params = entries.map(([, value]) => value)
  return {
    sql: `UPDATE ${table} SET ${assignments.join(', ')} WHERE ${idColumn} = $${entries.length + 1} RETURNING *`,
    params,
  }
}

function camelize(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), value]))
}

function snake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
}
