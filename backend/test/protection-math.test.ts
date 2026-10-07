import { describe, expect, it } from 'vitest'
import { capToOrderLimit, protectionBps, sizeHedge } from '../src/protection/protection.math'

const base = { existingShortQuantity: 0, stepSize: '0.01', minQuantity: '0.01' }

describe('sizeHedge', () => {
  // PRD section 7: 0.01 NVDA at $240, 100% protection, perp at $240 -> short 0.01.
  it('hedges 0.01 NVDA at $240 with a 0.01 short', () => {
    const sizing = sizeHedge({ ...base, stockQuantity: '0.01', stockMarkPrice: '240', perpMarkPrice: '240', protectionBps: 10_000 })
    expect(sizing.stockValue.toString()).toBe('2.4')
    expect(sizing.targetQuantity.toString()).toBe('0.01')
    expect(sizing.additionalQuantity.toString()).toBe('0.01')
    expect(sizing.sizeIssue).toBeNull()
  })

  // PRD section 8: $1,000 of stock at 75% -> short $750, remaining exposure $250.
  it('leaves $250 exposed when $1,000 of stock is protected at 75%', () => {
    const sizing = sizeHedge({ ...base, stockQuantity: '10', stockMarkPrice: '100', perpMarkPrice: '100', protectionBps: 7500 })
    expect(sizing.hedgeNotional.toString()).toBe('750')
    expect(sizing.targetQuantity.toString()).toBe('7.5')
    expect(sizing.netExposureAfter.toString()).toBe('250')
  })

  // PRD section 9: desired short $1,000, already short $300 -> new short $700.
  it('opens only the missing $700 when $300 is already short', () => {
    const sizing = sizeHedge({
      ...base,
      stockQuantity: '10',
      stockMarkPrice: '100',
      perpMarkPrice: '100',
      protectionBps: 10_000,
      existingShortQuantity: '3',
    })
    expect(sizing.additionalQuantity.toString()).toBe('7')
    expect(sizing.additionalNotional.toString()).toBe('700')
    expect(sizing.netExposureAfter.toString()).toBe('0')
  })

  it('opens nothing when the existing short already covers the target', () => {
    const sizing = sizeHedge({
      ...base,
      stockQuantity: '10',
      stockMarkPrice: '100',
      perpMarkPrice: '100',
      protectionBps: 5000,
      existingShortQuantity: '6',
    })
    expect(sizing.additionalQuantity.toString()).toBe('0')
    expect(sizing.sizeIssue).toBeNull()
  })

  it('still sizes 0.01 when the perp trades a few cents away from the stock', () => {
    const sizing = sizeHedge({ ...base, stockQuantity: '0.01', stockMarkPrice: '239.65', perpMarkPrice: '239.68', protectionBps: 10_000 })
    expect(sizing.targetQuantity.toString()).toBe('0.01')
    expect(sizing.sizeIssue).toBeNull()
  })

  // PRD section 10: the minimum quantity must be satisfied.
  it('refuses a level whose order is below the perp minimum', () => {
    const sizing = sizeHedge({ ...base, stockQuantity: '0.01', stockMarkPrice: '240', perpMarkPrice: '240', protectionBps: 2500 })
    expect(sizing.sizeIssue).toBe('BELOW_MINIMUM')
  })

  it('refuses a level that rounding would turn into a different level', () => {
    const half = sizeHedge({ ...base, stockQuantity: '0.01', stockMarkPrice: '240', perpMarkPrice: '240', protectionBps: 5000 })
    const threeQuarters = sizeHedge({ ...base, stockQuantity: '0.01', stockMarkPrice: '240', perpMarkPrice: '240', protectionBps: 7500 })
    expect(half.sizeIssue).toBe('OFF_GRID')
    expect(threeQuarters.sizeIssue).toBe('OFF_GRID')
  })

  it('refuses a top-up that is itself below the minimum', () => {
    const sizing = sizeHedge({
      ...base,
      stepSize: '0.001',
      stockQuantity: '1',
      stockMarkPrice: '100',
      perpMarkPrice: '100',
      protectionBps: 10_000,
      existingShortQuantity: '0.995',
    })
    expect(sizing.additionalQuantity.toString()).toBe('0.005')
    expect(sizing.sizeIssue).toBe('BELOW_MINIMUM')
  })
})

// PRD section 15: desired 0.01 with max 0.01 proceeds; desired 0.10 with max 0.07 is cut to 70%.
describe('capToOrderLimit', () => {
  it('keeps the order when the limit allows all of it', () => {
    expect(capToOrderLimit('0.01', '0.01', '0.01').toString()).toBe('0.01')
  })

  it('cuts 0.10 to 0.07 and reports 70% protection', () => {
    const safe = capToOrderLimit('0.10', '0.07', '0.01')
    expect(safe.toString()).toBe('0.07')
    expect(protectionBps(safe, '240', '24')).toBe(7000)
  })

  it('rounds the limit down to the quantity grid', () => {
    expect(capToOrderLimit('0.10', '0.0789', '0.01').toString()).toBe('0.07')
  })
})

// PRD section 20: desired 0.10, filled 0.06 -> actual protection 60%.
describe('protectionBps', () => {
  it('reports 60% when 0.06 of a 0.10 hedge filled', () => {
    expect(protectionBps('0.06', '240', '24')).toBe(6000)
  })

  it('reports nothing protected for an empty stock position', () => {
    expect(protectionBps('0.01', '240', '0')).toBe(0)
  })
})
