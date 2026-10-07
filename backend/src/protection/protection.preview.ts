// PRD sections 10, 15 and 16: everything the user sees before activating, computed from live data.

import Decimal from 'decimal.js'
import type { Backpack, Market } from '../backpack'
import { riskThresholds, type Config } from '../config'
import type { PolicyRepo } from '../db/policies'
import { HEDGED_STATUSES, type CloseRule, type ProtectionMode } from '../db/types'
import type { LivePrices } from '../market/live-prices'
import type { MarketSessionService, SessionSnapshot } from '../market/market-session.service'
import type { Portfolio, PortfolioService, StockHolding } from '../portfolio/portfolio.service'
import { selectGroupLeverage, selectLeverage, type LeverageChoice, type LeverageLeg } from '../risk/leverage-selector'
import type { RiskState } from '../risk/risk-rules'
import { capToOrderLimit, ceilToStep, floorToStep, protectionBps, sizeHedge, type HedgeSizing } from './protection.math'

export interface PreviewRequest {
  stockSymbol: string
  protectionBps: number
  mode: ProtectionMode
  customEndAt?: string
  /** WINDOW mode only: when the scheduled window ends and how the hedge closes then. */
  windowEndAt?: string
  closeRule?: CloseRule
  /** Set when this stock opens as part of a group: it is held to the group's leverage. */
  leverageFloor?: number
}

export interface GroupPreview {
  stockSymbols: string[]
  /** One leverage for every short in the group, or null when none covers them all. */
  leverage: number | null
  totalNotional: string
  initialMargin: string | null
  freeMargin: string
  projectedMmr: string | null
  blockers: string[]
}

export interface ProtectionPreview {
  stockSymbol: string
  stockName: string
  perpSymbol: string
  mode: ProtectionMode
  stockQuantity: string
  stockMarkPrice: string
  stockValue: string
  collateralWeight: string
  collateralValue: string
  perpMarkPrice: string
  perpIndexPrice: string
  requestedProtectionBps: number
  /** The most protection Backpack's order limit allows right now. */
  safeProtectionBps: number
  targetNotional: string
  targetQuantity: string
  existingShortQuantity: string
  orderQuantity: string
  orderLimitPrice: string
  maxOrderQuantity: string
  netExposureAfter: string
  leverage: number | null
  initialMargin: string | null
  projectedMmr: string | null
  projectedRisk: RiskState | null
  account: Portfolio['health']
  costs: { tradingFeeRoundTrip: string; fundingRateHourly: string | null; borrowInterest: 'variable' }
  session: SessionSnapshot
  reopenAt: string
  maxEndAt: string
  cooldownSec: number
  canActivate: boolean
  blockers: string[]
}

export class PreviewService {
  constructor(
    private readonly config: Config,
    private readonly backpack: Backpack,
    private readonly portfolioService: PortfolioService,
    private readonly prices: LivePrices,
    private readonly sessions: MarketSessionService,
    private readonly policies: PolicyRepo,
  ) {}

  async preview(request: PreviewRequest, now = Date.now()): Promise<ProtectionPreview> {
    const blockers: string[] = []
    const [portfolio, markets, session, live] = await Promise.all([
      this.portfolioService.get(),
      this.backpack.markets.list(),
      this.sessions.current(now),
      this.policies.listLive(),
    ])
    const holding = portfolio.holdings.find((h) => h.symbol === request.stockSymbol)
    const perp = findPerp(markets, request.stockSymbol)
    if (!this.config.TRADING_ENABLED) blockers.push('Trading is switched off (TRADING_ENABLED=false)')
    if (!this.config.ALLOWED_SYMBOLS.includes(request.stockSymbol)) blockers.push(`${request.stockSymbol} is not in ALLOWED_SYMBOLS`)
    if (!holding) blockers.push(`The account holds no ${request.stockSymbol}`)
    if (holding && new Decimal(holding.collateralWeight).lte(0)) blockers.push(`${request.stockSymbol} is not accepted as collateral`)
    if (!perp) blockers.push(`No perpetual market for ${request.stockSymbol}`)
    if (perp && perp.orderBookState !== 'Open') blockers.push(`${perp.symbol} order book is ${perp.orderBookState}`)
    if (portfolio.health.liquidating) blockers.push('The account is being liquidated')
    if (live.some((p) => p.leg.stockSymbol === request.stockSymbol)) blockers.push(`A protection for ${request.stockSymbol} is already live`)
    if (!holding || !perp) throw new PreviewBlocked(blockers)

    const [position, perpQuote] = await Promise.all([this.backpack.positions.get(perp.symbol), this.prices.perp(perp.symbol)])
    const netQuantity = new Decimal(position?.netQuantity ?? 0)
    if (netQuantity.gt(0)) blockers.push(`The account is long ${netQuantity} ${perp.symbol}; close it before protecting`)
    const existingShort = netQuantity.lt(0) ? netQuantity.abs() : new Decimal(0)

    const sizing = sizeHedge({
      stockQuantity: holding.quantity,
      stockMarkPrice: holding.markPrice,
      perpMarkPrice: perpQuote.markPrice,
      protectionBps: request.protectionBps,
      existingShortQuantity: existingShort,
      stepSize: perp.filters.quantity.stepSize,
      minQuantity: perp.filters.quantity.minQuantity,
    })
    if (sizing.sizeIssue === 'BELOW_MINIMUM') blockers.push(`The order would be below the perp minimum of ${perp.filters.quantity.minQuantity}`)
    if (sizing.sizeIssue === 'OFF_GRID') blockers.push(`${perp.symbol} trades in steps of ${perp.filters.quantity.stepSize}; this level cannot be sized exactly`)

    const limitPrice = sellLimitPrice(perpQuote.bestBid ?? perpQuote.markPrice, perp.filters.price.tickSize, this.config.MAX_SLIPPAGE_BPS)
    const maxOrderQuantity = sizing.additionalQuantity.gt(0)
      ? await this.backpack.orders.maxQuantity(perp.symbol, 'Ask', limitPrice)
      : sizing.additionalQuantity.toString()
    const safeOrderQuantity = capToOrderLimit(sizing.additionalQuantity, maxOrderQuantity, perp.filters.quantity.stepSize)
    const safeProtectionBps = protectionBps(existingShort.plus(safeOrderQuantity), perpQuote.markPrice, sizing.stockValue)
    if (safeOrderQuantity.lt(sizing.additionalQuantity)) {
      blockers.push(`Backpack allows at most ${maxOrderQuantity} ${perp.symbol} now, about ${Math.floor(safeProtectionBps / 100)}% protection`)
    }
    this.checkNotionalCaps(sizing, live, blockers)

    const leverage = sizing.additionalQuantity.gt(0) ? this.chooseLeverage(sizing, portfolio, perp, blockers, request.leverageFloor) : null
    const { reopenAt, maxEndAt, cooldownSec } = await this.window(request, now)

    return {
      stockSymbol: holding.symbol,
      stockName: holding.name,
      perpSymbol: perp.symbol,
      mode: request.mode,
      stockQuantity: holding.quantity,
      stockMarkPrice: holding.markPrice,
      stockValue: sizing.stockValue.toString(),
      collateralWeight: holding.collateralWeight,
      collateralValue: holding.collateralValue,
      perpMarkPrice: perpQuote.markPrice,
      perpIndexPrice: perpQuote.indexPrice,
      requestedProtectionBps: request.protectionBps,
      safeProtectionBps: Math.min(safeProtectionBps, request.protectionBps),
      targetNotional: sizing.hedgeNotional.toString(),
      targetQuantity: sizing.targetQuantity.toString(),
      existingShortQuantity: existingShort.toString(),
      orderQuantity: sizing.additionalQuantity.toString(),
      orderLimitPrice: limitPrice,
      maxOrderQuantity,
      netExposureAfter: sizing.netExposureAfter.toString(),
      leverage: leverage?.leverage ?? null,
      initialMargin: leverage?.initialMargin.toString() ?? null,
      projectedMmr: leverage?.projectedMmr.toString() ?? null,
      projectedRisk: leverage?.projectedRisk ?? null,
      account: portfolio.health,
      costs: {
        tradingFeeRoundTrip: sizing.additionalNotional.mul(portfolio.health.futuresTakerFeeRate).mul(2).toString(),
        fundingRateHourly: perpQuote.fundingRate,
        borrowInterest: 'variable',
      },
      session,
      reopenAt: reopenAt.toISOString(),
      maxEndAt: maxEndAt.toISOString(),
      cooldownSec,
      canActivate: blockers.length === 0,
      blockers,
    }
  }

  private checkNotionalCaps(sizing: HedgeSizing, live: Awaited<ReturnType<PolicyRepo['listLive']>>, blockers: string[]): void {
    const openNotional = live
      .filter((p) => HEDGED_STATUSES.includes(p.policy.status))
      .reduce((sum, p) => sum.plus(new Decimal(p.leg.actualQuantity).mul(p.leg.currentPerpPrice ?? p.leg.entryPrice ?? 0)), new Decimal(0))
    if (sizing.additionalNotional.gt(this.config.MAX_POSITION_NOTIONAL_USD)) {
      blockers.push(`Hedge of $${sizing.additionalNotional.toFixed(2)} exceeds MAX_POSITION_NOTIONAL_USD=${this.config.MAX_POSITION_NOTIONAL_USD}`)
    }
    if (openNotional.plus(sizing.additionalNotional).gt(this.config.MAX_TOTAL_NOTIONAL_USD)) {
      blockers.push(`Total hedged notional would exceed MAX_TOTAL_NOTIONAL_USD=${this.config.MAX_TOTAL_NOTIONAL_USD}`)
    }
  }

  private chooseLeverage(sizing: HedgeSizing, portfolio: Portfolio, perp: Market, blockers: string[], minLeverage?: number): LeverageChoice | null {
    if (!perp.imfFunction || !perp.mmfFunction) {
      blockers.push(`${perp.symbol} publishes no margin curve`)
      return null
    }
    const choice = selectLeverage({
      notional: sizing.additionalNotional,
      netEquity: portfolio.health.netEquity,
      netEquityAvailable: portfolio.health.netEquityAvailable,
      currentMaintenanceMargin: portfolio.health.maintenanceMargin,
      marketImf: perp.imfFunction,
      marketMmf: perp.mmfFunction,
      takerFeeRate: portfolio.health.futuresTakerFeeRate,
      maxApplicationLeverage: this.config.MAX_APPLICATION_LEVERAGE,
      marginBuffer: this.config.MARGIN_BUFFER,
      thresholds: riskThresholds(this.config),
      minLeverage,
    })
    if (!choice) {
      blockers.push(
        `No leverage up to ${this.config.MAX_APPLICATION_LEVERAGE}x fits: $${sizing.additionalNotional.toFixed(2)} of hedge against $${new Decimal(portfolio.health.netEquityAvailable).toFixed(2)} available`,
      )
    }
    return choice
  }

  /**
   * Several stocks hedged in one go share the account's margin, so they must fit side by side
   * under one leverage. Stocks that cannot be hedged at all are reported by their own preview.
   */
  async previewGroup(stockSymbols: string[], protectionBps: number): Promise<GroupPreview> {
    const [portfolio, markets, positions] = await Promise.all([this.portfolioService.get(), this.backpack.markets.list(), this.backpack.positions.list()])
    const legs: LeverageLeg[] = []
    for (const symbol of stockSymbols) {
      const holding = portfolio.holdings.find((h) => h.symbol === symbol)
      const perp = findPerp(markets, symbol)
      if (!holding || !perp?.imfFunction || !perp.mmfFunction) continue
      const quote = await this.prices.perp(perp.symbol)
      const net = new Decimal(positions.find((p) => p.symbol === perp.symbol)?.netQuantity ?? 0)
      const sizing = sizeHedge({
        stockQuantity: holding.quantity,
        stockMarkPrice: holding.markPrice,
        perpMarkPrice: quote.markPrice,
        protectionBps,
        existingShortQuantity: net.lt(0) ? net.abs() : 0,
        stepSize: perp.filters.quantity.stepSize,
        minQuantity: perp.filters.quantity.minQuantity,
      })
      if (sizing.additionalQuantity.gt(0)) legs.push({ notional: sizing.additionalNotional, marketImf: perp.imfFunction, marketMmf: perp.mmfFunction })
    }
    const total = legs.reduce((sum, leg) => sum.plus(leg.notional), new Decimal(0))
    const free = portfolio.health.netEquityAvailable
    const base = { stockSymbols, totalNotional: total.toString(), freeMargin: free }
    if (!legs.length) return { ...base, leverage: null, initialMargin: null, projectedMmr: null, blockers: [] }

    const choice = selectGroupLeverage({
      legs,
      netEquity: portfolio.health.netEquity,
      netEquityAvailable: free,
      currentMaintenanceMargin: portfolio.health.maintenanceMargin,
      takerFeeRate: portfolio.health.futuresTakerFeeRate,
      maxApplicationLeverage: this.config.MAX_APPLICATION_LEVERAGE,
      marginBuffer: this.config.MARGIN_BUFFER,
      thresholds: riskThresholds(this.config),
    })
    const max = this.config.MAX_APPLICATION_LEVERAGE
    const needed = total.div(max).mul(1 + this.config.MARGIN_BUFFER)
    const blockers = choice
      ? []
      : [
          needed.gt(free)
            ? `Not enough free margin to hedge these ${legs.length} stocks together: about $${needed.toFixed(2)} needed at ${max}x, $${new Decimal(free).toFixed(2)} free. Add USDC or choose fewer stocks.`
            : `Hedging these ${legs.length} stocks together would leave the account outside the safe margin band. Choose fewer stocks or a lower level.`,
        ]
    return { ...base, leverage: choice?.leverage ?? null, initialMargin: choice?.initialMargin.toString() ?? null, projectedMmr: choice?.projectedMmr.toString() ?? null, blockers }
  }

  private async window(request: PreviewRequest, now: number) {
    if (request.mode === 'WINDOW') {
      if (!request.windowEndAt) throw new Error('A WINDOW protection needs windowEndAt')
      const reopenAt = new Date(request.windowEndAt)
      if (request.closeRule === 'AT_END') return { reopenAt, maxEndAt: reopenAt, cooldownSec: 0 }
      const cooldownSec = this.config.REOPEN_COOLDOWN_SEC
      return { reopenAt, maxEndAt: new Date(reopenAt.getTime() + (cooldownSec + this.config.MAX_CONVERGENCE_WAIT_SEC) * 1000), cooldownSec }
    }
    const customEndAt = request.customEndAt ? new Date(request.customEndAt) : undefined
    const reopenAt = await this.sessions.reopenFor(request.mode, now, customEndAt)
    // A time the user chose is a close time, not a market reopen: no cooldown, no oracle wait.
    if (request.mode === 'CUSTOM') return { reopenAt, maxEndAt: reopenAt, cooldownSec: 0 }
    const cooldownSec = this.config.REOPEN_COOLDOWN_SEC
    const maxEndAt = new Date(reopenAt.getTime() + (cooldownSec + this.config.MAX_CONVERGENCE_WAIT_SEC) * 1000)
    return { reopenAt, maxEndAt, cooldownSec }
  }
}

export class PreviewBlocked extends Error {
  constructor(readonly blockers: string[]) {
    super(blockers.join('; '))
    this.name = 'PreviewBlocked'
  }
}

/** The perpetual whose base is this stock. */
export function findPerp(markets: Market[], stockSymbol: string): Market | undefined {
  const candidates = markets.filter((m) => m.marketType === 'PERP' && m.baseSymbol === stockSymbol && m.visible)
  return candidates.find((m) => m.quoteSymbol === 'USDC') ?? candidates[0]
}

/** A sell limit a little through the bid: fills like a market order but never worse than the bound. */
export function sellLimitPrice(bestBid: string, tickSize: string, slippageBps: number): string {
  return floorToStep(new Decimal(bestBid).mul(new Decimal(1).minus(new Decimal(slippageBps).div(10_000))), tickSize).toString()
}

/** A buy limit a little through the ask, for reduce-only closes. */
export function buyLimitPrice(bestAsk: string, tickSize: string, slippageBps: number): string {
  return ceilToStep(new Decimal(bestAsk).mul(new Decimal(1).plus(new Decimal(slippageBps).div(10_000))), tickSize).toString()
}

export type { StockHolding }
