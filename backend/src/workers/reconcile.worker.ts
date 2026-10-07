// PRD section 21: REST reconciliation keeps the database honest about what Backpack holds.
// Resolves orders with unknown outcomes, finishes interrupted opens and closes, and notices
// shorts that vanished outside the app.

import Decimal from 'decimal.js'
import type { Context } from '../context'
import type { HedgeExecutor } from '../execution/hedge.executor'
import type { ProtectionService } from '../protection/protection.service'

const INTERVAL_MS = 60_000

export class ReconcileWorker {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly ctx: Context,
    private readonly protection: ProtectionService,
    private readonly executor: HedgeExecutor,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.runOnce().catch((err) => this.ctx.log.error({ err }, 'reconcile failed')), INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async runOnce(): Promise<void> {
    for (const record of await this.ctx.orders.unresolved()) {
      const result = await this.executor.reconcile(record)
      this.ctx.log.info({ logicalId: record.logicalId, outcome: result.outcome }, 'reconciled order')
    }
    for (const item of await this.ctx.policies.listLive()) {
      const { policy, leg } = item
      if (policy.status === 'OPENING' || policy.status === 'CLOSING') {
        await this.protection.resume(policy.id)
        continue
      }
      if (policy.status === 'REDUCING') {
        // The process died mid-reduction: the fill, if any, is in the order record; go back to waiting.
        const last = (await this.ctx.policies.events(policy.id)).reverse().find((e) => e.toStatus === 'REDUCING')
        await this.ctx.policies.transition(policy.id, 'REDUCING', last?.fromStatus ?? 'ACTIVE', { recovered: true })
        continue
      }
      await this.checkVenuePosition(item.policy.id, leg.perpSymbol, leg.actualQuantity, leg.existingShortQuantity)
    }
  }

  /** If Backpack holds less short than we think, somebody else closed it. Record it, do not fight it. */
  private async checkVenuePosition(policyId: string, perpSymbol: string, actualQuantity: string, existingShort: string): Promise<void> {
    const ours = new Decimal(actualQuantity)
    if (ours.lte(0)) return
    const position = await this.ctx.backpack.positions.get(perpSymbol)
    const shortAtVenue = position && new Decimal(position.netQuantity).lt(0) ? new Decimal(position.netQuantity).abs() : new Decimal(0)
    const expected = ours.plus(existingShort)
    if (shortAtVenue.gte(expected)) return
    const remaining = Decimal.max(0, shortAtVenue.minus(existingShort))
    this.ctx.log.warn({ policyId, expected: expected.toString(), shortAtVenue: shortAtVenue.toString() }, 'short reduced outside the app')
    await this.ctx.policies.updateLeg(policyId, { actualQuantity: remaining.toString() })
    await this.ctx.policies.note(policyId, (await this.ctx.policies.get(policyId))!.policy.status, {
      externalReduction: { from: ours.toString(), to: remaining.toString() },
    })
    if (remaining.lte(0)) await this.protection.close(policyId, 'MANUAL')
  }
}
