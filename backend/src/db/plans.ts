import { updateSql, type Db } from './db'
import type { Plan, PlanRun, PlanRunStatus } from './types'

type NewPlan = Pick<Plan, 'ownerWallet' | 'windowKind' | 'customStart' | 'customEnd' | 'protectionBps' | 'stockSymbols' | 'startDate' | 'days'>
type NewRun = Pick<PlanRun, 'runDate' | 'windowStart' | 'windowEnd' | 'closeRule' | 'status' | 'note'>

export class PlanRepo {
  constructor(private readonly db: Db) {}

  async create(plan: NewPlan, runs: NewRun[]): Promise<{ plan: Plan; runs: PlanRun[] }> {
    return this.db.tx(async (q) => {
      const created = await q.one<Plan>(
        `INSERT INTO protection_plan (owner_wallet, status, window_kind, custom_start, custom_end, protection_bps, stock_symbols, start_date, days)
         VALUES ($1, 'ACTIVE', $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [plan.ownerWallet, plan.windowKind, plan.customStart, plan.customEnd, plan.protectionBps, plan.stockSymbols, plan.startDate, plan.days],
      )
      const createdRuns: PlanRun[] = []
      for (const run of runs) {
        createdRuns.push(
          await q.one<PlanRun>(
            `INSERT INTO plan_run (plan_id, run_date, window_start, window_end, close_rule, status, note)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [created.id, run.runDate, run.windowStart, run.windowEnd, run.closeRule, run.status, run.note],
          ),
        )
      }
      return { plan: created, runs: createdRuns }
    })
  }

  async get(id: string): Promise<{ plan: Plan; runs: PlanRun[] } | null> {
    const plan = await this.db.maybeOne<Plan>('SELECT * FROM protection_plan WHERE id = $1', [id])
    if (!plan) return null
    return { plan, runs: await this.runs(id) }
  }

  async list(limit = 50): Promise<Plan[]> {
    return this.db.query<Plan>('SELECT * FROM protection_plan ORDER BY created_at DESC LIMIT $1', [limit])
  }

  async listActive(): Promise<Plan[]> {
    return this.db.query<Plan>(`SELECT * FROM protection_plan WHERE status = 'ACTIVE' ORDER BY created_at`)
  }

  async runs(planId: string): Promise<PlanRun[]> {
    return this.db.query<PlanRun>('SELECT * FROM plan_run WHERE plan_id = $1 ORDER BY run_date', [planId])
  }

  /** Runs whose window has started and that have not been acted on. */
  async due(now: Date): Promise<PlanRun[]> {
    return this.db.query<PlanRun>(`SELECT * FROM plan_run WHERE status = 'SCHEDULED' AND window_start <= $1 ORDER BY window_start`, [now])
  }

  async open(): Promise<PlanRun[]> {
    return this.db.query<PlanRun>(`SELECT * FROM plan_run WHERE status IN ('OPENING', 'OPEN') ORDER BY window_start`)
  }

  /** Claims a run for opening; false when another tick got there first. */
  async claim(runId: string, from: PlanRunStatus, to: PlanRunStatus): Promise<boolean> {
    const rows = await this.db.query('UPDATE plan_run SET status = $3, updated_at = now() WHERE id = $1 AND status = $2 RETURNING id', [runId, from, to])
    return rows.length === 1
  }

  async updateRun(runId: string, patch: Partial<PlanRun>): Promise<PlanRun> {
    const { sql, params } = updateSql('plan_run', { ...patch, updatedAt: new Date() })
    return this.db.one<PlanRun>(sql, [...params, runId])
  }

  async updatePlan(planId: string, patch: Partial<Plan>): Promise<Plan> {
    const { sql, params } = updateSql('protection_plan', { ...patch, updatedAt: new Date() })
    return this.db.one<Plan>(sql, [...params, planId])
  }
}
