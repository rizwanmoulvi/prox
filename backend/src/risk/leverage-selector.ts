// PRD sections 13 and 14: use the lowest leverage that makes the hedge possible and leaves
// the account in the SAFE band afterwards. Never reach for the venue maximum.

import Decimal from 'decimal.js'
import type { MarginFunction } from '../backpack/markets'
import type { Num } from '../protection/protection.math'
import { riskStateFor, type RiskState, type RiskThresholds } from './risk-rules'

export const LEVERAGE_CANDIDATES = [1, 2, 3, 5] as const

/** One short to be opened: its size and its market's margin curves. */
export interface LeverageLeg {
  /** Notional of the short that still has to be opened. */
  notional: Num
  marketImf: MarginFunction
  marketMmf: MarginFunction
}

interface AccountFigures {
  netEquity: Num
  netEquityAvailable: Num
  /** Maintenance margin the account already carries, in USD. */
  currentMaintenanceMargin: Num
  /** Taker fee as a fraction of notional. */
  takerFeeRate: Num
  maxApplicationLeverage: number
  /** Extra room kept above the initial margin, as a fraction. 0.1 keeps 10% spare. */
  marginBuffer: Num
  thresholds: RiskThresholds
  /** Lowest leverage to consider: a hedge that is part of a group uses the group's leverage. */
  minLeverage?: number
}

export interface LeverageInput extends AccountFigures, LeverageLeg {}

export interface GroupLeverageInput extends AccountFigures {
  legs: LeverageLeg[]
}

export interface LeverageChoice {
  leverage: number
  initialMargin: Decimal
  projectedMmr: Decimal
  projectedRisk: RiskState
}

/** The lowest candidate that fits, or null when no allowed leverage makes the hedge safe. */
export function selectLeverage(input: LeverageInput): LeverageChoice | null {
  return selectGroupLeverage({ ...input, legs: [input] })
}

/**
 * One leverage for several shorts opened together. Backpack applies the account's leverage limit
 * to every position, so the shorts must fit side by side, not each on its own.
 */
export function selectGroupLeverage(input: GroupLeverageInput): LeverageChoice | null {
  return evaluateGroup(input).find((o) => o.fits && o.projectedRisk === 'SAFE') ?? null
}

/** Every allowed candidate with its numbers, for the preview to explain a refusal. */
export function evaluateLeverages(input: LeverageInput): (LeverageChoice & { fits: boolean })[] {
  return evaluateGroup({ ...input, legs: [input] })
}

export function evaluateGroup(input: GroupLeverageInput): (LeverageChoice & { fits: boolean })[] {
  const notionals = input.legs.map((leg) => new Decimal(leg.notional))
  const total = notionals.reduce((sum, n) => sum.plus(n), new Decimal(0))
  const maintenance = input.legs.reduce((sum, leg, i) => sum.plus(notionals[i]!.mul(evalMarginFunction(leg.marketMmf, notionals[i]!))), new Decimal(0))
  // The market with the strictest initial margin decides how far leverage can go.
  const highestImf = input.legs.reduce((max, leg, i) => Decimal.max(max, evalMarginFunction(leg.marketImf, notionals[i]!)), new Decimal(0))
  const equityAfterFee = new Decimal(input.netEquity).minus(total.mul(input.takerFeeRate))
  const projectedMmr = equityAfterFee.gt(0)
    ? new Decimal(input.currentMaintenanceMargin).plus(maintenance).div(equityAfterFee)
    : new Decimal(Infinity)
  const projectedRisk = riskStateFor(projectedMmr, input.thresholds)

  return LEVERAGE_CANDIDATES.filter(
    (leverage) => leverage <= input.maxApplicationLeverage && leverage >= (input.minLeverage ?? 1) && highestImf.lte(new Decimal(1).div(leverage)),
  ).map((leverage) => {
    const initialMargin = total.div(leverage)
    const needed = initialMargin.mul(new Decimal(1).plus(input.marginBuffer))
    return { leverage, initialMargin, projectedMmr, projectedRisk, fits: needed.lte(input.netEquityAvailable) }
  })
}

/** Backpack margin curve: the fraction grows with the square root of the notional. */
export function evalMarginFunction(fn: MarginFunction, notional: Num): Decimal {
  if (fn.type !== 'sqrt') throw new Error(`Unsupported margin function type: ${fn.type}`)
  return Decimal.max(fn.base, new Decimal(fn.factor).mul(new Decimal(notional).sqrt()))
}
