// PRD sections 21 to 28: keeps every live policy's prices, PnL, margin and lifecycle current.
// Runs every few seconds, faster when the account leaves the SAFE band.

import Decimal from 'decimal.js'
import type { Context } from '../context'
import { HEDGED_STATUSES, type PolicyWithLeg } from '../db/types'
import { nextLifecycleStatus } from '../protection/lifecycle'
import type { ProtectionService } from '../protection/protection.service'
import { marginRates, riskStateFor } from '../risk/risk-rules'
import type { RiskService } from '../risk/risk.service'
import { riskThresholds } from '../config'

const CALM_INTERVAL_MS = 5000
const ALERT_INTERVAL_MS = 2000
const PNL_POINT_EVERY_MS = 30_000

export class MonitorWorker {
  private timer: NodeJS.Timeout | null = null
  private running = false
  private lastPointAt = new Map<string, number>()

  constructor(
    private readonly ctx: Context,
    private readonly protection: ProtectionService,
    private readonly risk: RiskService,
  ) {}

  start(): void {
    this.schedule(0)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => void this.tick(), delay)
  }

  private async tick(): Promise<void> {
    if (this.running) return this.schedule(CALM_INTERVAL_MS)
    this.running = true
    let interval = CALM_INTERVAL_MS
    try {
      interval = await this.runOnce()
    } catch (error) {
      this.ctx.log.error({ err: error }, 'monitor tick failed')
    } finally {
      this.running = false
      this.schedule(interval)
    }
  }

  /** Returns the delay before the next tick. */
  async runOnce(): Promise<number> {
    const live = (await this.ctx.policies.listLive()).filter((p) => HEDGED_STATUSES.includes(p.policy.status))
    if (!live.length) return CALM_INTERVAL_MS
    const [collateral, session] = await Promise.all([this.ctx.backpack.collateral.get(), this.ctx.sessions.current()])
    const rates = marginRates(collateral)
    const state = riskStateFor(rates.mmr, riskThresholds(this.ctx.config))

    for (const item of live) {
      try {
        await this.refreshPnl(item, rates.mmr.toString())
        await this.advanceLifecycle(item, session.state)
        await this.risk.apply(item, state)
      } catch (error) {
        this.ctx.log.error({ err: error, policyId: item.policy.id }, 'monitor failed for policy')
      }
    }
    this.ctx.events.publish('account.health', { mmr: rates.mmr.toString(), imr: rates.imr.toString(), risk: state, session: session.state })
    return state === 'SAFE' ? CALM_INTERVAL_MS : ALERT_INTERVAL_MS
  }

  /** PRD section 24: underlying move + hedge move = net result, from live prices. */
  private async refreshPnl(item: PolicyWithLeg, mmr: string): Promise<void> {
    const { policy, leg } = item
    const [perp, stock] = await Promise.all([this.ctx.prices.perp(leg.perpSymbol), this.ctx.prices.stock(leg.stockSymbol).catch(() => null)])
    const stockPrice = new Decimal(stock?.mid ?? leg.currentStockPrice ?? leg.stockMarkPrice)
    const perpPrice = new Decimal(perp.markPrice)
    const unrealized = new Decimal(leg.entryPrice ?? perpPrice).minus(perpPrice).mul(leg.actualQuantity)
    const hedgePnl = new Decimal(leg.realizedPnl).plus(unrealized)
    const underlyingPnl = stockPrice.minus(leg.stockMarkPrice).mul(leg.stockQuantity)
    const costs = new Decimal(leg.fees).minus(leg.funding)
    await this.ctx.policies.updateLeg(policy.id, {
      currentStockPrice: stockPrice.toString(),
      currentPerpPrice: perpPrice.toString(),
      pnl: hedgePnl.toString(),
      currentMmr: mmr,
    })
    const last = this.lastPointAt.get(policy.id) ?? 0
    if (Date.now() - last >= PNL_POINT_EVERY_MS) {
      this.lastPointAt.set(policy.id, Date.now())
      await this.ctx.policies.addPnlPoint({
        policyId: policy.id,
        stockPrice: stockPrice.toString(),
        perpPrice: perpPrice.toString(),
        underlyingPnl: underlyingPnl.toString(),
        hedgePnl: hedgePnl.toString(),
        costs: costs.toString(),
        net: underlyingPnl.plus(hedgePnl).minus(costs).toString(),
      })
    }
    this.ctx.events.publish('policy.pnl', {
      policyId: policy.id,
      stockPrice: stockPrice.toString(),
      perpPrice: perpPrice.toString(),
      underlyingPnl: underlyingPnl.toString(),
      hedgePnl: hedgePnl.toString(),
      costs: costs.toString(),
      net: underlyingPnl.plus(hedgePnl).minus(costs).toString(),
      mmr,
    })
  }

  private async advanceLifecycle(item: PolicyWithLeg, session: Parameters<typeof nextLifecycleStatus>[2]): Promise<void> {
    const next = nextLifecycleStatus(item.policy, Date.now(), session)
    if (!next) return
    await this.ctx.policies.transition(item.policy.id, item.policy.status, next, { session })
    this.ctx.events.publish('policy.updated', { policyId: item.policy.id })
    if (next === 'EXPIRED') await this.protection.close(item.policy.id, item.policy.closeRule === 'AT_END' ? 'WINDOW_END' : 'EXPIRED')
  }
}
