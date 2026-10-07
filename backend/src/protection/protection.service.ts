// Owns the protection state machine: activation, risk reductions, closing and the receipt.

import Decimal from 'decimal.js'
import type { Market } from '../backpack'
import type { Context } from '../context'
import { StateConflictError } from '../db/policies'
import { HEDGED_STATUSES, type CloseReason, type HedgeLeg, type Policy, type PolicyStatus, type PolicyWithLeg } from '../db/types'
import type { ExecutionResult, HedgeExecutor } from '../execution/hedge.executor'
import { marginRates } from '../risk/risk-rules'
import { hedgedStatus } from './lifecycle'
import { protectionBps } from './protection.math'
import { findPerp, type PreviewRequest, type PreviewService } from './protection.preview'
import { buildReceipt } from './receipt'

export class ActivationBlocked extends Error {
  constructor(readonly blockers: string[]) {
    super(blockers.join('; '))
    this.name = 'ActivationBlocked'
  }
}

// How many IOC attempts one close may take before the reconciler takes over.
const CLOSE_ATTEMPTS = 3

export type StockResult = { policyId?: string; error?: string }

export class ProtectionService {
  constructor(
    private readonly ctx: Context,
    private readonly preview: PreviewService,
    private readonly executor: HedgeExecutor,
  ) {}

  /** PRD section 3, steps "User activates" to "Confirm actual fill". */
  async activate(request: PreviewRequest, ownerWallet: string, planRunId: string | null = null): Promise<PolicyWithLeg> {
    const p = await this.preview.preview(request)
    if (!p.canActivate) throw new ActivationBlocked(p.blockers)
    const orderQuantity = new Decimal(p.orderQuantity)
    if (orderQuantity.lte(0)) throw new ActivationBlocked(['Nothing to open: an existing short already covers this level'])
    if (p.leverage === null) throw new ActivationBlocked(['No leverage was selected'])

    const created = await this.ctx.policies.create(
      {
        mode: request.mode,
        requestedProtectionBps: request.protectionBps,
        reopenAt: new Date(p.reopenAt),
        maxEndAt: new Date(p.maxEndAt),
        cooldownSec: p.cooldownSec,
        ownerWallet,
        planRunId,
        closeRule: request.mode === 'WINDOW' ? (request.closeRule ?? 'CONVERGENCE') : request.mode === 'CUSTOM' ? 'AT_END' : 'CONVERGENCE',
      },
      {
        stockSymbol: p.stockSymbol,
        perpSymbol: p.perpSymbol,
        stockQuantity: p.stockQuantity,
        stockMarkPrice: p.stockMarkPrice,
        stockMarketValue: p.stockValue,
        collateralWeight: p.collateralWeight,
        collateralValue: p.collateralValue,
        targetProtectionBps: request.protectionBps,
        targetNotional: p.targetNotional,
        targetQuantity: p.targetQuantity,
        accountLeverage: p.leverage,
      },
      p.existingShortQuantity,
    )
    const id = created.policy.id
    await this.ctx.policies.transition(id, 'VALIDATING', 'READY', { orderQuantity: p.orderQuantity, leverage: p.leverage, limitPrice: p.orderLimitPrice })

    const perp = await this.perpFor(p.perpSymbol)
    const leverageOk = await this.ensureLeverage(id, p.leverage, perp, orderQuantity, p.orderLimitPrice)
    if (!leverageOk) return (await this.ctx.policies.get(id))!

    await this.ctx.policies.transition(id, 'READY', 'OPENING')
    this.ctx.prices.watchPerp(perp.symbol)
    this.ctx.prices.watchStock(p.stockSymbol)
    const result = await this.executor.openShort(id, perp, orderQuantity, 1)
    await this.applyOpenResult((await this.ctx.policies.get(id))!, result)
    return (await this.ctx.policies.get(id))!
  }

  /**
   * Opens several stocks in one go. Their shorts share the account's margin, so the whole group
   * opens at one leverage, the lowest that covers all of them. If none does, nothing opens.
   */
  async activateMany(requests: PreviewRequest[], ownerWallet: string, planRunId: string | null = null): Promise<Record<string, StockResult>> {
    const results: Record<string, StockResult> = {}
    let leverageFloor: number | undefined
    if (requests.length > 1) {
      try {
        leverageFloor = await this.groupLeverage(requests)
      } catch (error) {
        for (const r of requests) results[r.stockSymbol] = { error: (error as Error).message }
        return results
      }
    }
    for (const request of requests) {
      try {
        const created = await this.activate({ ...request, leverageFloor }, ownerWallet, planRunId)
        results[request.stockSymbol] = created.policy.status === 'FAILED' ? { policyId: created.policy.id, error: created.policy.failureReason ?? 'did not fill' } : { policyId: created.policy.id }
      } catch (error) {
        results[request.stockSymbol] = { error: (error as Error).message }
      }
      this.ctx.log.info({ planRunId, stockSymbol: request.stockSymbol, leverageFloor, result: results[request.stockSymbol] }, 'group activation')
    }
    return results
  }

  /** Reduce-only close of what this policy opened. Safe to call again while CLOSING. */
  async close(policyId: string, reason: CloseReason): Promise<PolicyWithLeg> {
    const current = await this.mustGet(policyId)
    if (!HEDGED_STATUSES.includes(current.policy.status)) {
      throw new Error(`Policy ${policyId} is ${current.policy.status}; there is nothing to close`)
    }
    if (current.policy.status !== 'CLOSING') {
      await this.ctx.policies.transition(policyId, current.policy.status, 'CLOSING', { reason })
      await this.ctx.policies.updatePolicy(policyId, { closeReason: reason })
    }
    await this.continueClose(policyId)
    return this.mustGet(policyId)
  }

  /** Picks up an OPENING or CLOSING policy after a restart or an unknown order outcome. */
  async resume(policyId: string): Promise<void> {
    const { policy } = await this.mustGet(policyId)
    if (policy.status === 'CLOSING') await this.continueClose(policyId)
    if (policy.status === 'OPENING') {
      const record = (await this.ctx.orders.forPolicy(policyId)).find((o) => o.purpose === 'OPEN')
      if (!record) {
        await this.ctx.policies.transition(policyId, 'OPENING', 'FAILED', { reason: 'No order was recorded' })
        return
      }
      const result = await this.executor.reconcile(record)
      await this.applyOpenResult(await this.mustGet(policyId), result)
    }
  }

  /** PRD section 27, REDUCE: one preset step down (100 -> 75 -> 50 -> 25). */
  async reduceOneStep(policyId: string): Promise<'REDUCED' | 'TOO_SMALL' | 'BUSY'> {
    const { policy, leg } = await this.mustGet(policyId)
    if (!['ACTIVE', 'PARTIAL', 'WAIT_REOPEN', 'WAIT_CONVERGENCE'].includes(policy.status)) return 'BUSY'
    const perp = await this.perpFor(leg.perpSymbol)
    const nextBps = Math.max(0, Math.floor(policy.actualProtectionBps / 2500) * 2500 - 2500)
    const keep = new Decimal(leg.stockMarketValue).mul(nextBps).div(10_000).div(leg.currentPerpPrice ?? leg.entryPrice ?? 1)
    const closeQty = new Decimal(leg.actualQuantity).minus(keep).toDecimalPlaces(stepDecimals(perp), Decimal.ROUND_UP)
    if (closeQty.lt(perp.filters.quantity.minQuantity) || closeQty.gt(leg.actualQuantity)) return 'TOO_SMALL'

    await this.ctx.policies.transition(policyId, policy.status, 'REDUCING', { toProtectionBps: nextBps, closeQty: closeQty.toString() })
    const attempt = (await this.ctx.orders.countForPolicy(policyId, 'REDUCE')) + 1
    const result = await this.executor.closeShort(policyId, perp, closeQty, attempt, 'REDUCE')
    if (result.outcome !== 'UNKNOWN') await this.applyCloseFill(policyId, result)
    const after = await this.mustGet(policyId)
    const back = hedgedStatusAfterReduce(policy.status, after.policy)
    await this.ctx.policies.transition(policyId, 'REDUCING', back, { filled: result.filledQuantity.toString() })
    return 'REDUCED'
  }

  /** PRD section 33: pretend the cash market reopened now, with real prices and real orders. */
  async demoReopen(policyId: string): Promise<PolicyWithLeg> {
    if (!this.ctx.config.DEMO_MODE) throw new Error('DEMO_MODE is off')
    const { policy } = await this.mustGet(policyId)
    if (!['ACTIVE', 'PARTIAL', 'WAIT_REOPEN'].includes(policy.status)) throw new Error(`Cannot demo-reopen a ${policy.status} policy`)
    const now = new Date()
    const cooldownSec = this.ctx.config.DEMO_COOLDOWN_SEC
    const maxEndAt = new Date(now.getTime() + (cooldownSec + this.ctx.config.MAX_CONVERGENCE_WAIT_SEC) * 1000)
    await this.ctx.policies.updatePolicy(policyId, { demoOverride: true, reopenAt: now, cooldownSec, maxEndAt })
    await this.ctx.policies.transition(policyId, policy.status, 'WAIT_CONVERGENCE', { demoReopen: true, cooldownSec })
    this.ctx.events.publish('policy.updated', { policyId })
    return this.mustGet(policyId)
  }

  async applyOpenResult(current: PolicyWithLeg, result: ExecutionResult): Promise<void> {
    const { policy, leg } = current
    if (policy.status !== 'OPENING') return
    if (result.outcome === 'UNKNOWN') {
      await this.ctx.policies.note(policy.id, 'OPENING', { pending: result.record.logicalId })
      return
    }
    if (result.outcome === 'REJECTED' || result.outcome === 'UNFILLED') {
      await this.ctx.policies.updatePolicy(policy.id, { failureReason: result.record.error ?? 'Order did not fill' })
      await this.ctx.policies.transition(policy.id, 'OPENING', 'FAILED', { order: result.record.logicalId, error: result.record.error })
      this.ctx.events.publish('policy.updated', { policyId: policy.id })
      return
    }
    const collateral = await this.ctx.backpack.collateral.get()
    const rates = marginRates(collateral)
    const filled = result.filledQuantity
    const entry = result.avgPrice ?? new Decimal(result.record.price ?? 0)
    const actualBps = protectionBps(new Decimal(leg.existingShortQuantity).plus(filled), entry, leg.stockMarketValue)
    await this.ctx.policies.updateLeg(policy.id, {
      actualQuantity: filled.toString(),
      openedQuantity: filled.toString(),
      entryPrice: entry.toString(),
      currentPerpPrice: entry.toString(),
      fees: result.fee.toString(),
      openedAt: new Date(),
      openingImr: rates.imr.toString(),
      openingMmr: rates.mmr.toString(),
      currentMmr: rates.mmr.toString(),
      openClientId: result.record.clientId,
    })
    const updated = await this.ctx.policies.updatePolicy(policy.id, { actualProtectionBps: actualBps })
    await this.ctx.policies.transition(policy.id, 'OPENING', hedgedStatus(updated), {
      filled: filled.toString(),
      entryPrice: entry.toString(),
      fee: result.fee.toString(),
    })
    this.ctx.events.publish('policy.updated', { policyId: policy.id })
    void this.ctx.anchor?.anchor(policy.id, 'OPENED', {
      policyId: policy.id,
      stock: leg.stockSymbol,
      perp: leg.perpSymbol,
      quantity: filled.toString(),
      entryPrice: entry.toString(),
      openedAt: new Date().toISOString(),
    })
  }

  private async continueClose(policyId: string): Promise<void> {
    const { leg } = await this.mustGet(policyId)
    const perp = await this.perpFor(leg.perpSymbol)
    const startAttempt = (await this.ctx.orders.countForPolicy(policyId, 'CLOSE')) + 1
    for (let attempt = startAttempt; attempt < startAttempt + CLOSE_ATTEMPTS; attempt++) {
      const current = await this.mustGet(policyId)
      const remaining = new Decimal(current.leg.actualQuantity)
      if (remaining.lte(0)) break
      const position = await this.ctx.backpack.positions.get(perp.symbol)
      const shortAtVenue = position && new Decimal(position.netQuantity).lt(0) ? new Decimal(position.netQuantity).abs() : new Decimal(0)
      const quantity = Decimal.min(remaining, shortAtVenue)
      if (quantity.lte(0)) {
        // Backpack no longer shows our short: it was closed outside the app (liquidation, manual).
        await this.ctx.policies.updateLeg(policyId, { actualQuantity: '0' })
        await this.ctx.policies.note(policyId, 'CLOSING', { externalClose: true, remaining: remaining.toString() })
        break
      }
      const result = await this.executor.closeShort(policyId, perp, quantity, attempt, 'CLOSE')
      if (result.outcome === 'UNKNOWN') return
      await this.applyCloseFill(policyId, result)
    }
    const after = await this.mustGet(policyId)
    if (new Decimal(after.leg.actualQuantity).lte(0)) await this.finishClose(after)
  }

  private async applyCloseFill(policyId: string, result: ExecutionResult): Promise<void> {
    if (result.filledQuantity.lte(0)) return
    const { leg } = await this.mustGet(policyId)
    const filled = result.filledQuantity
    const price = result.avgPrice ?? new Decimal(result.record.price ?? 0)
    const closedBefore = new Decimal(leg.openedQuantity).minus(leg.actualQuantity)
    const exitPrice = closedBefore.gt(0) && leg.exitPrice
      ? new Decimal(leg.exitPrice).mul(closedBefore).plus(price.mul(filled)).div(closedBefore.plus(filled))
      : price
    const realized = new Decimal(leg.entryPrice ?? 0).minus(price).mul(filled)
    const actualQuantity = new Decimal(leg.actualQuantity).minus(filled)
    const stockValue = new Decimal(leg.stockMarketValue)
    await this.ctx.policies.updateLeg(policyId, {
      actualQuantity: actualQuantity.toString(),
      exitPrice: exitPrice.toString(),
      realizedPnl: new Decimal(leg.realizedPnl).plus(realized).toString(),
      fees: new Decimal(leg.fees).plus(result.fee).toString(),
      closeClientId: result.record.clientId,
    })
    await this.ctx.policies.updatePolicy(policyId, {
      actualProtectionBps: protectionBps(new Decimal(leg.existingShortQuantity).plus(actualQuantity), price, stockValue),
    })
  }

  private async finishClose(current: PolicyWithLeg): Promise<void> {
    const { policy, leg } = current
    const stockQuote = await this.ctx.prices.stock(leg.stockSymbol).catch(() => null)
    const exitStockPrice = stockQuote?.mid ?? leg.currentStockPrice ?? leg.stockMarkPrice
    const closedLeg = await this.ctx.policies.updateLeg(policy.id, { exitStockPrice, closedAt: new Date() })
    const orders = await this.ctx.orders.forPolicy(policy.id)
    const receipt = await buildReceipt(this.ctx.backpack, policy, closedLeg, orders)
    await this.ctx.policies.updatePolicy(policy.id, { receipt: receipt as unknown as Record<string, unknown> })
    try {
      await this.ctx.policies.transition(policy.id, 'CLOSING', 'CLOSED', { exitPrice: closedLeg.exitPrice, realizedPnl: closedLeg.realizedPnl })
    } catch (error) {
      if (!(error instanceof StateConflictError)) throw error
    }
    this.ctx.events.publish('policy.closed', { policyId: policy.id })
    void this.ctx.anchor?.anchor(policy.id, 'RECEIPT', receipt)
  }

  /**
   * The leverage a group opens at. The account limit is raised to it first, so every stock's
   * order limit is read at that leverage. Throws when no allowed leverage covers the group.
   */
  private async groupLeverage(requests: PreviewRequest[]): Promise<number | undefined> {
    const group = await this.preview.previewGroup(requests.map((r) => r.stockSymbol), requests[0]!.protectionBps)
    if (group.blockers.length) throw new ActivationBlocked(group.blockers)
    if (group.leverage === null) return undefined
    const account = await this.ctx.backpack.account.get()
    if (new Decimal(account.leverageLimit).lt(group.leverage)) {
      await this.ctx.backpack.account.setLeverageLimit(String(group.leverage))
      this.ctx.log.info({ from: account.leverageLimit, to: group.leverage }, 'account leverage raised for a group')
    }
    return group.leverage
  }

  /** PRD section 12: raise the account limit when the chosen leverage needs it. Never lower it. */
  private async ensureLeverage(policyId: string, leverage: number, perp: Market, quantity: Decimal, limitPrice: string): Promise<boolean> {
    const account = await this.ctx.backpack.account.get()
    if (new Decimal(account.leverageLimit).gte(leverage)) return true
    await this.ctx.backpack.account.setLeverageLimit(String(leverage))
    await this.ctx.policies.note(policyId, 'READY', { leverageLimit: { from: account.leverageLimit, to: leverage } })
    const max = await this.ctx.backpack.orders.maxQuantity(perp.symbol, 'Ask', limitPrice)
    if (new Decimal(max).gte(quantity)) return true
    await this.ctx.policies.updatePolicy(policyId, { failureReason: `Backpack allows only ${max} after setting leverage ${leverage}x` })
    await this.ctx.policies.transition(policyId, 'READY', 'FAILED', { maxOrderQuantity: max })
    return false
  }

  private async perpFor(perpSymbol: string): Promise<Market> {
    const markets = await this.ctx.backpack.markets.list()
    const perp = markets.find((m) => m.symbol === perpSymbol) ?? findPerp(markets, perpSymbol.split('_')[0]!)
    if (!perp) throw new Error(`Unknown perp ${perpSymbol}`)
    return perp
  }

  private async mustGet(policyId: string): Promise<PolicyWithLeg> {
    const found = await this.ctx.policies.get(policyId)
    if (!found) throw new Error(`Unknown policy ${policyId}`)
    return found
  }
}

function hedgedStatusAfterReduce(previous: PolicyStatus, policy: Policy): PolicyStatus {
  if (previous === 'WAIT_REOPEN' || previous === 'WAIT_CONVERGENCE') return previous
  return hedgedStatus(policy)
}

function stepDecimals(perp: Market): number {
  return new Decimal(perp.filters.quantity.stepSize).decimalPlaces()
}

export type { HedgeLeg }
