// Internal risk bands from PRD section 26, keyed on Backpack's maintenance margin rate.
// Backpack liquidates at MMR = 100%; these thresholds act well before that.

import Decimal from 'decimal.js'
import type { Num } from '../protection/protection.math'

export type RiskState = 'SAFE' | 'WATCH' | 'RISK' | 'REDUCE' | 'EMERGENCY'

export interface RiskThresholds {
  warning: Num
  risk: Num
  reduce: Num
  emergency: Num
}

export interface MarginFractions {
  imf?: string | null
  mmf?: string | null
  marginFraction?: string | null
}

export interface MarginRates {
  /** Initial margin in use as a share of net equity. At 1 no new exposure can open. */
  imr: Decimal
  /** Maintenance margin as a share of net equity. At 1 liquidation starts. */
  mmr: Decimal
}

export function riskStateFor(mmr: Num, thresholds: RiskThresholds): RiskState {
  const value = new Decimal(mmr)
  if (value.lt(thresholds.warning)) return 'SAFE'
  if (value.lt(thresholds.risk)) return 'WATCH'
  if (value.lt(thresholds.reduce)) return 'RISK'
  if (value.lte(thresholds.emergency)) return 'REDUCE'
  return 'EMERGENCY'
}

/**
 * Backpack reports the required fractions (imf, mmf) and the account's margin fraction, all
 * relative to exposure. Dividing them gives the rates relative to net equity.
 */
export function marginRates(fractions: MarginFractions): MarginRates {
  const noExposure = fractions.marginFraction == null || fractions.mmf == null
  if (noExposure) return { imr: new Decimal(0), mmr: new Decimal(0) }
  const marginFraction = new Decimal(fractions.marginFraction!)
  // Exposure with no equity behind it is past every threshold.
  if (marginFraction.lte(0)) return { imr: new Decimal(Infinity), mmr: new Decimal(Infinity) }
  return {
    imr: new Decimal(fractions.imf ?? 0).div(marginFraction),
    mmr: new Decimal(fractions.mmf!).div(marginFraction),
  }
}
