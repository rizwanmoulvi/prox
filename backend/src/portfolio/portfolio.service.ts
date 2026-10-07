// What the account holds and how healthy its margin is, read straight from Backpack.

import Decimal from 'decimal.js'
import type { Backpack, Collateral, Position } from '../backpack'
import { marginRates, riskStateFor, type RiskState, type RiskThresholds } from '../risk/risk-rules'

export interface StockHolding {
  symbol: string
  name: string
  quantity: string
  markPrice: string
  marketValue: string
  collateralWeight: string
  collateralValue: string
}

export interface AssetBalance {
  symbol: string
  quantity: string
  marketValue: string
  collateralValue: string
}

export interface AccountHealth {
  portfolioValue: string
  netEquity: string
  netEquityAvailable: string
  netEquityLocked: string
  borrowLiability: string
  pnlUnrealized: string
  /** Initial margin in use / net equity. */
  imr: string
  /** Maintenance margin / net equity. Liquidation at 1. */
  mmr: string
  /** Maintenance margin in USD, needed to project the effect of a new position. */
  maintenanceMargin: string
  risk: RiskState
  leverageLimit: string
  futuresTakerFeeRate: string
  liquidating: boolean
}

export interface Portfolio {
  holdings: StockHolding[]
  otherAssets: AssetBalance[]
  positions: Position[]
  health: AccountHealth
  collateral: Collateral
  fetchedAt: string
}

export class PortfolioService {
  constructor(
    private readonly backpack: Backpack,
    private readonly thresholds: RiskThresholds,
  ) {}

  async get(): Promise<Portfolio> {
    const [collateral, account, positions, securities] = await Promise.all([
      this.backpack.collateral.get(),
      this.backpack.account.get(),
      this.backpack.positions.list(),
      this.backpack.stocks.securities(),
    ])
    const names = new Map(securities.map((s) => [s.asset, s.name]))
    const held = collateral.collateral.filter((c) => new Decimal(c.totalQuantity).gt(0))
    const holdings = held
      .filter((c) => names.has(c.symbol))
      .map((c) => ({
        symbol: c.symbol,
        name: names.get(c.symbol)!,
        quantity: c.totalQuantity,
        markPrice: c.assetMarkPrice,
        marketValue: c.balanceNotional,
        collateralWeight: c.collateralWeight,
        collateralValue: c.collateralValue,
      }))
    const otherAssets = held
      .filter((c) => !names.has(c.symbol))
      .map((c) => ({ symbol: c.symbol, quantity: c.totalQuantity, marketValue: c.balanceNotional, collateralValue: c.collateralValue }))

    const rates = marginRates(collateral)
    const health: AccountHealth = {
      portfolioValue: collateral.assetsValue,
      netEquity: collateral.netEquity,
      netEquityAvailable: collateral.netEquityAvailable,
      netEquityLocked: collateral.netEquityLocked,
      borrowLiability: collateral.borrowLiability,
      pnlUnrealized: collateral.pnlUnrealized,
      imr: rates.imr.toString(),
      mmr: rates.mmr.toString(),
      maintenanceMargin: rates.mmr.isFinite() ? rates.mmr.mul(collateral.netEquity).toString() : collateral.netEquity,
      risk: riskStateFor(rates.mmr, this.thresholds),
      leverageLimit: account.leverageLimit,
      futuresTakerFeeRate: feeRate(account.futuresTakerFee),
      liquidating: account.liquidating,
    }
    return { holdings, otherAssets, positions, health, collateral, fetchedAt: new Date().toISOString() }
  }
}

/**
 * Backpack states fees in basis points ("4.5" means 0.045%). The live execution test compares
 * this against the fee charged on the first real fill.
 */
export function feeRate(feeBps: string): string {
  return new Decimal(feeBps).div(10_000).toString()
}
