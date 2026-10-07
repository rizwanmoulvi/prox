// PRD section 27: what the app does at each risk band. Driven by the monitor worker with the
// account's live maintenance margin rate; never by the oracle.

import type { Context } from '../context'
import type { PolicyWithLeg } from '../db/types'
import type { ProtectionService } from '../protection/protection.service'
import type { RiskState } from './risk-rules'

// Do not fire a second reduction while the first one is still settling on the venue.
const ACTION_COOLDOWN_MS = 60_000

export class RiskService {
  private readonly lastActionAt = new Map<string, number>()

  constructor(
    private readonly ctx: Context,
    private readonly protection: ProtectionService,
  ) {}

  async apply(item: PolicyWithLeg, state: RiskState): Promise<void> {
    const { policy } = item
    if (policy.riskState !== state) {
      await this.ctx.policies.updatePolicy(policy.id, { riskState: state })
      await this.ctx.policies.note(policy.id, policy.status, { riskState: state })
      this.ctx.events.publish('policy.risk', { policyId: policy.id, riskState: state })
    }
    if (state === 'REDUCE') await this.reduce(item)
    if (state === 'EMERGENCY') await this.emergency(item)
  }

  private async reduce(item: PolicyWithLeg): Promise<void> {
    if (this.onCooldown(item.policy.id)) return
    const outcome = await this.protection.reduceOneStep(item.policy.id)
    this.ctx.log.warn({ policyId: item.policy.id, outcome }, 'risk REDUCE')
    if (outcome === 'TOO_SMALL') {
      await this.ctx.policies.note(item.policy.id, item.policy.status, { reduce: 'too small for a partial close; full close at EMERGENCY' })
    }
    this.lastActionAt.set(item.policy.id, Date.now())
  }

  private async emergency(item: PolicyWithLeg): Promise<void> {
    const status = item.policy.status
    if (status === 'CLOSING' || status === 'EMERGENCY' || status === 'REDUCING') return
    this.ctx.log.error({ policyId: item.policy.id }, 'risk EMERGENCY: closing the hedge')
    await this.ctx.policies.transition(item.policy.id, status, 'EMERGENCY', { mmr: item.leg.currentMmr })
    await this.protection.close(item.policy.id, 'EMERGENCY')
  }

  private onCooldown(policyId: string): boolean {
    const last = this.lastActionAt.get(policyId)
    return last !== undefined && Date.now() - last < ACTION_COOLDOWN_MS
  }
}
