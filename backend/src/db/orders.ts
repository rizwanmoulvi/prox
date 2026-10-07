import { updateSql, type Db } from './db'
import type { OrderRecord } from './types'

type NewOrderRecord = Pick<OrderRecord, 'policyId' | 'logicalId' | 'clientId' | 'purpose' | 'symbol' | 'side' | 'reduceOnly' | 'quantity' | 'price'>

export class OrderRepo {
  constructor(private readonly db: Db) {}

  /** Written before the order leaves the machine, so a crash mid-flight leaves a trace to reconcile. */
  async create(order: NewOrderRecord): Promise<OrderRecord> {
    return this.db.one<OrderRecord>(
      `INSERT INTO order_record (policy_id, logical_id, client_id, purpose, symbol, side, reduce_only, quantity, price, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING') RETURNING *`,
      [order.policyId, order.logicalId, order.clientId, order.purpose, order.symbol, order.side, order.reduceOnly, order.quantity, order.price],
    )
  }

  async update(logicalId: string, patch: Partial<OrderRecord>): Promise<OrderRecord> {
    const { sql, params } = updateSql('order_record', { ...patch, updatedAt: new Date() }, 'logical_id')
    return this.db.one<OrderRecord>(sql, [...params, logicalId])
  }

  async byLogicalId(logicalId: string): Promise<OrderRecord | null> {
    return this.db.maybeOne<OrderRecord>('SELECT * FROM order_record WHERE logical_id = $1', [logicalId])
  }

  async forPolicy(policyId: string): Promise<OrderRecord[]> {
    return this.db.query<OrderRecord>('SELECT * FROM order_record WHERE policy_id = $1 ORDER BY id', [policyId])
  }

  /** Orders whose outcome we never learned. */
  async unresolved(): Promise<OrderRecord[]> {
    return this.db.query<OrderRecord>(`SELECT * FROM order_record WHERE status IN ('PENDING', 'UNKNOWN') ORDER BY id`)
  }

  async countForPolicy(policyId: string, purpose: string): Promise<number> {
    const row = await this.db.one<{ count: number }>(
      'SELECT count(*)::int AS count FROM order_record WHERE policy_id = $1 AND purpose = $2',
      [policyId, purpose],
    )
    return row.count
  }
}
