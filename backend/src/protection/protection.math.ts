// Hedge sizing from PRD sections 7, 8, 9, 15 and 20. Pure functions, exact decimals.

import Decimal from 'decimal.js'

export type Num = Decimal.Value

export interface HedgeSizingInput {
  stockQuantity: Num
  stockMarkPrice: Num
  perpMarkPrice: Num
  /** 10000 = 100% */
  protectionBps: number
  /** Size of a short already open in this perp, as a positive number. */
  existingShortQuantity: Num
  stepSize: Num
  minQuantity: Num
}

export interface HedgeSizing {
  stockValue: Decimal
  hedgeNotional: Decimal
  /** Total short wanted, on the perp's quantity grid. */
  targetQuantity: Decimal
  /** What still has to be sold after counting the existing short. */
  additionalQuantity: Decimal
  additionalNotional: Decimal
  netExposureAfter: Decimal
  /** Why this protection level cannot be traded on the perp's quantity grid, if it cannot. */
  sizeIssue: SizeIssue | null
}

/** BELOW_MINIMUM: the order is smaller than the perp accepts. OFF_GRID: rounding would change the level. */
export type SizeIssue = 'BELOW_MINIMUM' | 'OFF_GRID'

// A rounded quantity may differ from the exact one by at most this share before the level is refused.
const MAX_GRID_ERROR = 0.05

export function sizeHedge(input: HedgeSizingInput): HedgeSizing {
  const perpMark = new Decimal(input.perpMarkPrice)
  const stockValue = new Decimal(input.stockQuantity).mul(input.stockMarkPrice)
  const hedgeNotional = stockValue.mul(input.protectionBps).div(10_000)
  const exactQuantity = hedgeNotional.div(perpMark)
  const targetQuantity = roundToStep(exactQuantity, input.stepSize)
  const additionalQuantity = Decimal.max(0, targetQuantity.minus(input.existingShortQuantity))
  const totalShort = Decimal.max(targetQuantity, input.existingShortQuantity)
  return {
    stockValue,
    hedgeNotional,
    targetQuantity,
    additionalQuantity,
    additionalNotional: additionalQuantity.mul(perpMark),
    netExposureAfter: stockValue.minus(totalShort.mul(perpMark)),
    sizeIssue: sizeIssueFor(exactQuantity, targetQuantity, additionalQuantity, input.minQuantity),
  }
}

function sizeIssueFor(exact: Decimal, target: Decimal, additional: Decimal, minQuantity: Num): SizeIssue | null {
  if (target.lt(minQuantity)) return 'BELOW_MINIMUM'
  if (additional.gt(0) && additional.lt(minQuantity)) return 'BELOW_MINIMUM'
  if (target.minus(exact).abs().div(exact).gt(MAX_GRID_ERROR)) return 'OFF_GRID'
  return null
}

/** PRD section 15: never ask for more than Backpack says the account may trade. */
export function capToOrderLimit(desiredQuantity: Num, maxOrderQuantity: Num, stepSize: Num): Decimal {
  return floorToStep(Decimal.min(desiredQuantity, maxOrderQuantity), stepSize)
}

/** Share of the stock position that a short of this size offsets, in basis points. */
export function protectionBps(shortQuantity: Num, perpPrice: Num, stockValue: Num): number {
  const value = new Decimal(stockValue)
  if (value.lte(0)) return 0
  return new Decimal(shortQuantity).mul(perpPrice).div(value).mul(10_000).toDecimalPlaces(0).toNumber()
}

export function roundToStep(quantity: Num, stepSize: Num): Decimal {
  return new Decimal(quantity).div(stepSize).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).mul(stepSize)
}

export function floorToStep(quantity: Num, stepSize: Num): Decimal {
  return new Decimal(quantity).div(stepSize).floor().mul(stepSize)
}

export function ceilToStep(quantity: Num, stepSize: Num): Decimal {
  return new Decimal(quantity).div(stepSize).ceil().mul(stepSize)
}
