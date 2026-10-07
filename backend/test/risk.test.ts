import { describe, expect, it } from 'vitest'
import { evalMarginFunction, evaluateLeverages, selectGroupLeverage, selectLeverage, type LeverageInput } from '../src/risk/leverage-selector'
import { marginRates, riskStateFor } from '../src/risk/risk-rules'

// PRD section 45 defaults.
const thresholds = { warning: '0.50', risk: '0.65', reduce: '0.80', emergency: '0.90' }

// PRD section 26: <50% SAFE, 50-65% WATCH, 65-80% RISK, 80-90% REDUCE, >90% EMERGENCY.
describe('riskStateFor', () => {
  it.each([
    ['0', 'SAFE'],
    ['0.4999', 'SAFE'],
    ['0.50', 'WATCH'],
    ['0.6499', 'WATCH'],
    ['0.65', 'RISK'],
    ['0.7999', 'RISK'],
    ['0.80', 'REDUCE'],
    ['0.90', 'REDUCE'],
    ['0.9001', 'EMERGENCY'],
    ['1.5', 'EMERGENCY'],
  ])('maps an MMR of %s to %s', (mmr, expected) => {
    expect(riskStateFor(mmr, thresholds)).toBe(expected)
  })
})

describe('marginRates', () => {
  it('divides the required fractions by the margin fraction', () => {
    const rates = marginRates({ imf: '0.1', mmf: '0.05', marginFraction: '0.25' })
    expect(rates.imr.toString()).toBe('0.4')
    expect(rates.mmr.toString()).toBe('0.2')
  })

  it('is zero for an account with no exposure', () => {
    expect(marginRates({ imf: null, mmf: null, marginFraction: null }).mmr.toString()).toBe('0')
  })

  it('is past every threshold when exposure has no equity behind it', () => {
    const rates = marginRates({ imf: '0.1', mmf: '0.05', marginFraction: '0' })
    expect(riskStateFor(rates.mmr, thresholds)).toBe('EMERGENCY')
  })
})

// NVDA.US_USDC_PERP curves as Backpack publishes them.
const nvda = {
  marketImf: { type: 'sqrt', base: '0.1', factor: '0.0006' },
  marketMmf: { type: 'sqrt', base: '0.05', factor: '0.00036' },
}

const input = (overrides: Partial<LeverageInput>): LeverageInput => ({
  notional: '1000',
  netEquity: '620',
  netEquityAvailable: '620',
  currentMaintenanceMargin: '0',
  takerFeeRate: '0',
  maxApplicationLeverage: 2,
  marginBuffer: '0.1',
  thresholds,
  ...nvda,
  ...overrides,
})

describe('selectLeverage', () => {
  // PRD section 13: $1,000 hedge against $620 of collateral. 1x needs ~$1,000 (impossible),
  // 2x needs ~$500 (possible), so the engine picks 2x.
  it('picks 2x for a $1,000 hedge on $620 of collateral', () => {
    const choice = selectLeverage(input({}))
    expect(choice?.leverage).toBe(2)
    expect(choice?.initialMargin.toString()).toBe('500')
    expect(choice?.projectedRisk).toBe('SAFE')
  })

  it('stays at 1x when the account can fund the hedge in full', () => {
    expect(selectLeverage(input({ netEquity: '1200', netEquityAvailable: '1200' }))?.leverage).toBe(1)
  })

  it('never goes above the application maximum', () => {
    expect(selectLeverage(input({ netEquity: '300', netEquityAvailable: '300' }))).toBeNull()
    expect(selectLeverage(input({ netEquity: '300', netEquityAvailable: '300', maxApplicationLeverage: 5 }))?.leverage).toBe(5)
  })

  it('keeps the margin buffer free', () => {
    // 2x needs $500. With a 10% buffer that is $550, so $540 is not enough.
    expect(selectLeverage(input({ netEquityAvailable: '540' }))).toBeNull()
    expect(selectLeverage(input({ netEquityAvailable: '550' }))?.leverage).toBe(2)
  })

  it('refuses a hedge that would leave the account outside the SAFE band', () => {
    // $300 of existing maintenance margin plus $50 for this hedge is 56% of $620.
    expect(selectLeverage(input({ currentMaintenanceMargin: '300' }))).toBeNull()
  })

  it('skips leverage the market itself does not allow', () => {
    const tight = { type: 'sqrt', base: '0.5', factor: '0' }
    const leverages = evaluateLeverages(input({ marketImf: tight, maxApplicationLeverage: 5 })).map((o) => o.leverage)
    expect(leverages).toEqual([1, 2])
  })
})

describe('evalMarginFunction', () => {
  it('uses the base fraction for small positions and grows with size', () => {
    expect(evalMarginFunction(nvda.marketImf, '2.4').toString()).toBe('0.1')
    expect(evalMarginFunction(nvda.marketImf, '1000000').toString()).toBe('0.6')
  })

  it('refuses a curve type it does not know', () => {
    expect(() => evalMarginFunction({ type: 'linear', base: '0.1', factor: '0' }, '1')).toThrow()
  })
})

// The account on 2026-10-07: 0.01 NVDA ($2.3874 to hedge) and 0.01 SPCX ($1.6794), $2.97 free,
// both perps with NVDA's margin curves.
describe('selectGroupLeverage', () => {
  const account = { netEquity: '2.97', netEquityAvailable: '2.97', currentMaintenanceMargin: '0', takerFeeRate: '0.0005', marginBuffer: '0.1', thresholds }
  const legs = [
    { notional: '2.3874', ...nvda },
    { notional: '1.6794', ...nvda },
  ]

  it('fits each stock alone at 1x but needs 2x for both together', () => {
    expect(selectLeverage({ ...account, ...legs[0]!, maxApplicationLeverage: 2 })?.leverage).toBe(1)
    expect(selectLeverage({ ...account, ...legs[1]!, maxApplicationLeverage: 2 })?.leverage).toBe(1)
    const both = selectGroupLeverage({ ...account, legs, maxApplicationLeverage: 2 })
    expect(both?.leverage).toBe(2)
    expect(both?.initialMargin.toString()).toBe('2.0334')
    expect(both?.projectedRisk).toBe('SAFE')
  })

  it('refuses the group when even the highest allowed leverage cannot cover it', () => {
    expect(selectGroupLeverage({ ...account, netEquityAvailable: '2.0', legs, maxApplicationLeverage: 2 })).toBeNull()
    expect(selectGroupLeverage({ ...account, netEquityAvailable: '2.0', legs, maxApplicationLeverage: 3 })?.leverage).toBe(3)
  })

  it('holds a single hedge to the leverage its group was given', () => {
    expect(selectLeverage({ ...account, ...legs[0]!, maxApplicationLeverage: 2, minLeverage: 2 })?.leverage).toBe(2)
  })

  it('lets the strictest market cap the whole group', () => {
    const strict = { notional: '1', marketImf: { type: 'sqrt', base: '0.6', factor: '0' }, marketMmf: nvda.marketMmf }
    const options = selectGroupLeverage({ ...account, netEquityAvailable: '100', netEquity: '100', legs: [legs[0]!, strict], maxApplicationLeverage: 5 })
    expect(options?.leverage).toBe(1)
  })
})
