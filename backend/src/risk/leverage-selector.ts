// PRD sections 13 and 14: use the lowest leverage that makes the hedge possible and leaves
// the account in the SAFE band afterwards. Never reach for the venue maximum.

import Decimal from 'decimal.js'
import type { MarginFunction } from '../backpack/markets'
import type { Num } from '../protection/protection.math'
import { riskStateFor, type RiskState, type RiskThresholds } from './risk-rules'

export const LEVERAGE_CANDIDATES = [1, 2, 3, 5] as const

export interface LeverageInput {
  /** Notional of the short that still has to be opened. */
  notional: Num
  netEquity: Num
  netEquityAvailable: Num
  /** Maintenance margin the account already carries, in USD. */
  currentMaintenanceMargin: Num
  marketImf: MarginFunction
  marketMmf: MarginFunction
  /** Taker fee as a fraction of notional. */
  takerFeeRate: Num
  maxApplicationLeverage: number
  /** Extra room kept above the initial margin, as a fraction. 0.1 keeps 10% spare. */
  marginBuffer: Num
  thresholds: RiskThresholds
}

export interface LeverageChoice {
  leverage: number
  initialMargin: Decimal
  projectedMmr: Decimal
  projectedRisk: RiskState
}

/** The lowest candidate that fits, or null when no allowed leverage makes the hedge safe. */
export function selectLeverage(input: LeverageInput): LeverageChoice | null {
  const options = evaluateLeverages(input)
  return options.find((o) => o.fits && o.projectedRisk === 'SAFE') ?? null
}

/** Every allowed candidate with its numbers, for the preview to explain a refusal. */
export function evaluateLeverages(input: LeverageInput): (LeverageChoice & { fits: boolean })[] {
  const notional = new Decimal(input.notional)
  const marketImf = evalMarginFunction(input.marketImf, notional)
  const maintenance = notional.mul(evalMarginFunction(input.marketMmf, notional))
  const equityAfterFee = new Decimal(input.netEquity).minus(notional.mul(input.takerFeeRate))
  const projectedMmr = equityAfterFee.gt(0)
    ? new Decimal(input.currentMaintenanceMargin).plus(maintenance).div(equityAfterFee)
    : new Decimal(Infinity)
  const projectedRisk = riskStateFor(projectedMmr, input.thresholds)

  return LEVERAGE_CANDIDATES.filter(
    (leverage) => leverage <= input.maxApplicationLeverage && marketImf.lte(new Decimal(1).div(leverage)),
  ).map((leverage) => {
    const initialMargin = notional.div(leverage)
    const needed = initialMargin.mul(new Decimal(1).plus(input.marginBuffer))
    return { leverage, initialMargin, projectedMmr, projectedRisk, fits: needed.lte(input.netEquityAvailable) }
  })
}

/** Backpack margin curve: the fraction grows with the square root of the notional. */
export function evalMarginFunction(fn: MarginFunction, notional: Num): Decimal {
  if (fn.type !== 'sqrt') throw new Error(`Unsupported margin function type: ${fn.type}`)
  return Decimal.max(fn.base, new Decimal(fn.factor).mul(new Decimal(notional).sqrt()))
}
