import { updateSql, type Db, type Queryable } from './db'
import {
  TERMINAL_STATUSES,
  type Anchor,
  type HedgeLeg,
  type PnlPoint,
  type Policy,
  type PolicyEvent,
  type PolicyStatus,
  type PolicyWithLeg,
} from './types'

export class StateConflictError extends Error {
  constructor(policyId: string, expected: PolicyStatus, to: PolicyStatus) {
    super(`Policy ${policyId} is no longer ${expected}, cannot move to ${to}`)
    this.name = 'StateConflictError'
  }
}

type NewPolicy = Pick<Policy, 'mode' | 'requestedProtectionBps' | 'reopenAt' | 'maxEndAt' | 'cooldownSec' | 'ownerWallet' | 'planRunId' | 'closeRule'>
type NewLeg = Omit<HedgeLeg, 'id' | 'policyId' | 'status' | 'actualQuantity' | 'openedQuantity' | 'existingShortQuantity' | 'pnl' | 'realizedPnl' | 'funding' | 'fees' | 'borrowCost' | 'convergenceCount' | 'openedAt' | 'closedAt' | 'entryPrice' | 'exitPrice' | 'exitStockPrice' | 'currentStockPrice' | 'currentPerpPrice' | 'openingImr' | 'openingMmr' | 'currentMmr' | 'openClientId' | 'closeClientId' | 'basisBps'>

export class PolicyRepo {
  constructor(private readonly db: Db) {}

  /** Inserts the policy as VALIDATING together with its single hedge leg. */
  async create(policy: NewPolicy, leg: NewLeg, existingShortQuantity: string): Promise<PolicyWithLeg> {
    return this.db.tx(async (q) => {
      const created = await q.one<Policy>(
        `INSERT INTO protection_policy (status, mode, requested_protection_bps, reopen_at, max_end_at, cooldown_sec, owner_wallet, plan_run_id, close_rule)
         VALUES ('VALIDATING', $1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [policy.mode, policy.requestedProtectionBps, policy.reopenAt, policy.maxEndAt, policy.cooldownSec, policy.ownerWallet, policy.planRunId, policy.closeRule],
      )
      const createdLeg = await q.one<HedgeLeg>(
        `INSERT INTO hedge_leg (policy_id, status, stock_symbol, perp_symbol, stock_quantity, stock_mark_price, stock_market_value,
           collateral_weight, collateral_value, target_protection_bps, target_notional, target_quantity, account_leverage, existing_short_quantity)
         VALUES ($1, 'VALIDATING', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [
          created.id,
          leg.stockSymbol,
          leg.perpSymbol,
          leg.stockQuantity,
          leg.stockMarkPrice,
          leg.stockMarketValue,
          leg.collateralWeight,
          leg.collateralValue,
          leg.targetProtectionBps,
          leg.targetNotional,
          leg.targetQuantity,
          leg.accountLeverage,
          existingShortQuantity,
        ],
      )
      await addEvent(q, created.id, null, 'VALIDATING', null)
      return { policy: created, leg: createdLeg }
    })
  }

  async get(id: string): Promise<PolicyWithLeg | null> {
    const policy = await this.db.maybeOne<Policy>('SELECT * FROM protection_policy WHERE id = $1', [id])
    if (!policy) return null
    const leg = await this.db.one<HedgeLeg>('SELECT * FROM hedge_leg WHERE policy_id = $1', [id])
    return { policy, leg }
  }

  async forPlanRun(planRunId: string): Promise<PolicyWithLeg[]> {
    const policies = await this.db.query<Policy>('SELECT * FROM protection_policy WHERE plan_run_id = $1 ORDER BY created_at', [planRunId])
    return this.withLegs(policies)
  }

  async list(limit = 50): Promise<PolicyWithLeg[]> {
    const policies = await this.db.query<Policy>('SELECT * FROM protection_policy ORDER BY created_at DESC LIMIT $1', [limit])
    return this.withLegs(policies)
  }

  /** Policies that are not finished, oldest first. */
  async listLive(): Promise<PolicyWithLeg[]> {
    const policies = await this.db.query<Policy>(
      'SELECT * FROM protection_policy WHERE NOT (status = ANY($1)) ORDER BY created_at',
      [TERMINAL_STATUSES],
    )
    return this.withLegs(policies)
  }

  /**
   * Moves a policy (and its leg) from one status to another, recording the event.
   * Fails if another worker moved it first.
   */
  async transition(id: string, from: PolicyStatus, to: PolicyStatus, detail: Record<string, unknown> | null = null): Promise<Policy> {
    return this.db.tx(async (q) => {
      const updated = await q.maybeOne<Policy>(
        `UPDATE protection_policy SET status = $3, updated_at = now() WHERE id = $1 AND status = $2 RETURNING *`,
        [id, from, to],
      )
      if (!updated) throw new StateConflictError(id, from, to)
      await q.query('UPDATE hedge_leg SET status = $2 WHERE policy_id = $1', [id, to])
      await addEvent(q, id, from, to, detail)
      return updated
    })
  }

  async updatePolicy(id: string, patch: Partial<Policy>): Promise<Policy> {
    const { sql, params } = updateSql('protection_policy', { ...patch, updatedAt: new Date() })
    return this.db.one<Policy>(sql, [...params, id])
  }

  async updateLeg(policyId: string, patch: Partial<HedgeLeg>): Promise<HedgeLeg> {
    const { sql, params } = updateSql('hedge_leg', patch, 'policy_id')
    return this.db.one<HedgeLeg>(sql, [...params, policyId])
  }

  async note(policyId: string, status: PolicyStatus, detail: Record<string, unknown>): Promise<void> {
    await addEvent(this.db, policyId, status, status, detail)
  }

  async events(policyId: string): Promise<PolicyEvent[]> {
    return this.db.query<PolicyEvent>('SELECT * FROM policy_event WHERE policy_id = $1 ORDER BY id', [policyId])
  }

  async addPnlPoint(point: Omit<PnlPoint, 'id' | 'at'>): Promise<void> {
    await this.db.query(
      `INSERT INTO pnl_point (policy_id, stock_price, perp_price, underlying_pnl, hedge_pnl, costs, net)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [point.policyId, point.stockPrice, point.perpPrice, point.underlyingPnl, point.hedgePnl, point.costs, point.net],
    )
  }

  async pnlPoints(policyId: string, limit = 2000): Promise<PnlPoint[]> {
    return this.db.query<PnlPoint>(
      'SELECT * FROM (SELECT * FROM pnl_point WHERE policy_id = $1 ORDER BY id DESC LIMIT $2) recent ORDER BY id',
      [policyId, limit],
    )
  }

  async saveAnchor(anchor: Omit<Anchor, 'id' | 'createdAt'>): Promise<Anchor> {
    return this.db.one<Anchor>(
      `INSERT INTO anchor (policy_id, kind, digest, memo, status, signature, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (policy_id, kind) DO UPDATE SET status = EXCLUDED.status, signature = EXCLUDED.signature, error = EXCLUDED.error
       RETURNING *`,
      [anchor.policyId, anchor.kind, anchor.digest, anchor.memo, anchor.status, anchor.signature, anchor.error],
    )
  }

  async anchors(policyId: string): Promise<Anchor[]> {
    return this.db.query<Anchor>('SELECT * FROM anchor WHERE policy_id = $1 ORDER BY id', [policyId])
  }

  private async withLegs(policies: Policy[]): Promise<PolicyWithLeg[]> {
    if (!policies.length) return []
    const legs = await this.db.query<HedgeLeg>('SELECT * FROM hedge_leg WHERE policy_id = ANY($1)', [policies.map((p) => p.id)])
    const byPolicy = new Map(legs.map((leg) => [leg.policyId, leg]))
    return policies.map((policy) => ({ policy, leg: byPolicy.get(policy.id)! }))
  }
}

async function addEvent(q: Queryable, policyId: string, from: PolicyStatus | null, to: PolicyStatus, detail: Record<string, unknown> | null) {
  await q.query('INSERT INTO policy_event (policy_id, from_status, to_status, detail) VALUES ($1, $2, $3, $4)', [
    policyId,
    from,
    to,
    detail === null ? null : JSON.stringify(detail),
  ])
}
