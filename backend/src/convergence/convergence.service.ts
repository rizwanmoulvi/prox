// PRD sections 31 to 33: counts consecutive oracle observations inside the basis threshold and
// closes the hedge when enough of them line up. Observations come from the CRE workflow; the
// backend cross-checks each one against its own live prices before it counts.

import Decimal from 'decimal.js'
import { centiBpsToBps, type OracleObservation, type OracleReport } from '@prox/core'
import type { Context } from '../context'
import type { Attestation, PolicyWithLeg } from '../db/types'
import { checksCountFrom } from '../protection/lifecycle'
import type { ProtectionService } from '../protection/protection.service'

// Two reports less than this far apart count as one look at the market.
const MIN_SPACING_MS = 20_000
// An observation older than this says nothing about the market now.
const MAX_AGE_MS = 120_000

export class ConvergenceService {
  constructor(
    private readonly ctx: Context,
    private readonly protection: ProtectionService,
  ) {}

  /** The stock/perp pairs the oracle should be watching right now. */
  async watchlist(): Promise<{ stockSymbol: string; perpSymbol: string }[]> {
    const live = await this.ctx.policies.listLive()
    const pairs = new Map(live.map((p) => [p.leg.stockSymbol, { stockSymbol: p.leg.stockSymbol, perpSymbol: p.leg.perpSymbol }]))
    return [...pairs.values()]
  }

  async onAttestation(attestation: Attestation, report: OracleReport): Promise<void> {
    const live = await this.ctx.policies.listLive()
    for (const item of live) {
      const observation = report.observations.find((o) => o.stockSymbol === item.leg.stockSymbol && o.perpSymbol === item.leg.perpSymbol)
      if (!observation) continue
      const basisBps = centiBpsToBps(observation.basisCentiBps)
      await this.ctx.policies.updateLeg(item.policy.id, { basisBps: basisBps.toString() })
      if (item.policy.status === 'WAIT_CONVERGENCE') await this.evaluate(item, attestation, observation, basisBps)
      this.ctx.events.publish('policy.basis', { policyId: item.policy.id, basisBps, session: observation.session })
    }
  }

  private async evaluate(item: PolicyWithLeg, attestation: Attestation, observation: OracleObservation, basisBps: number): Promise<void> {
    const { policy, leg } = item
    const observedAt = attestation.observedAt.getTime()
    const rejectReason = await this.rejectReason(item, attestation, observation, observedAt)
    const passed = basisBps <= this.ctx.config.CONVERGENCE_BPS
    const counted = rejectReason === null
    const countAfter = !counted ? leg.convergenceCount : passed ? leg.convergenceCount + 1 : 0

    await this.ctx.attestations.addCheck({
      policyId: policy.id,
      attestationId: attestation.id,
      observedAt: new Date(observedAt),
      basisBps: basisBps.toString(),
      session: observation.session,
      passed,
      counted,
      rejectReason,
      countAfter,
    })
    await this.ctx.policies.updateLeg(policy.id, { convergenceCount: countAfter })
    this.ctx.log.info({ policyId: policy.id, basisBps, passed, counted, rejectReason, countAfter }, 'convergence check')

    if (countAfter >= this.ctx.config.CONVERGENCE_COUNT) {
      const streak = await this.ctx.attestations.countedChecks(policy.id, countAfter)
      void this.ctx.anchor?.anchor(policy.id, 'CONVERGED', {
        policyId: policy.id,
        checks: streak.map((c) => ({ attestationId: c.attestationId, basisBps: c.basisBps, observedAt: c.observedAt.toISOString() })),
        thresholdBps: this.ctx.config.CONVERGENCE_BPS,
      })
      await this.protection.close(policy.id, 'CONVERGED')
    }
  }

  private async rejectReason(item: PolicyWithLeg, attestation: Attestation, o: OracleObservation, observedAt: number): Promise<string | null> {
    const { policy } = item
    if (Date.now() - observedAt > MAX_AGE_MS) return 'STALE'
    if (observedAt < checksCountFrom(policy)) return 'BEFORE_COOLDOWN'
    if (!policy.demoOverride && o.session !== 'REGULAR') return 'MARKET_CLOSED'
    if (!policy.demoOverride && o.referenceSource !== 'INDICATIVE_QUOTE') return 'NO_CASH_QUOTE'
    const last = (await this.ctx.attestations.countedChecks(policy.id, 1))[0]
    if (last && observedAt - last.observedAt.getTime() < MIN_SPACING_MS) return 'TOO_SOON'
    if (attestation.mode === 'SIMULATION' && this.ctx.config.CRE_REPORT_MODE === 'don') return 'SIMULATED_IN_DON_MODE'
    return this.priceMismatch(item, o)
  }

  /** The oracle's numbers have to agree with what the backend sees itself (plan rule 10). */
  private async priceMismatch(item: PolicyWithLeg, o: OracleObservation): Promise<string | null> {
    const tolerance = this.ctx.config.ORACLE_TOLERANCE_BPS
    const perp = await this.ctx.prices.perp(item.leg.perpSymbol)
    if (deviationBps(perp.markPrice, o.perpMarkE8) > tolerance) return 'ORACLE_PERP_MISMATCH'
    const stock = await this.ctx.prices.stock(item.leg.stockSymbol).catch(() => null)
    if (stock?.mid && deviationBps(stock.mid, o.referenceE8) > tolerance) return 'ORACLE_REFERENCE_MISMATCH'
    return null
  }
}

function deviationBps(local: string, oracleE8: bigint): number {
  const oracle = new Decimal(oracleE8.toString()).div(1e8)
  return new Decimal(local).minus(oracle).abs().div(oracle).mul(10_000).toNumber()
}
