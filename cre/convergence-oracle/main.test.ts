import { describe, expect, test } from 'bun:test'
import { toE8 } from '../../packages/core/src'
import { toObservation, type PairReading } from './main'

const pair = { stockSymbol: 'NVDA.US', perpSymbol: 'NVDA.US_USDC_PERP' }

// Values read from Backpack on 2026-10-06 20:28 UTC: perp mark 239.68, index 239.64998,
// indicative quote estimated 239.58 (sell) / 239.72 (buy), post-market session.
const reading: PairReading = {
  perpMarkE8: toE8('239.68'),
  perpIndexE8: toE8('239.64998'),
  stockBidE8: toE8('239.58'),
  stockAskE8: toE8('239.72'),
  quoteAvailable: 1n,
  quoteTimestampMs: 1791319303267n,
  sessionIndex: 2n,
}

describe('toObservation', () => {
  test('uses the quote midpoint as the reference and reports the basis against it', () => {
    const o = toObservation(pair, reading)
    expect(o.referenceSource).toBe('INDICATIVE_QUOTE')
    expect(o.referenceE8).toBe(toE8('239.65'))
    // |239.68 - 239.65| / 239.65 = 1.2518 bps
    expect(o.basisCentiBps).toBe(125)
    expect(o.session).toBe('POSTMARKET')
  })

  test('falls back to the perp index when the quoter has no price', () => {
    const o = toObservation(pair, { ...reading, quoteAvailable: 0n, stockBidE8: 0n, stockAskE8: 0n, sessionIndex: 4n })
    expect(o.referenceSource).toBe('PERP_INDEX')
    expect(o.referenceE8).toBe(toE8('239.64998'))
    expect(o.stockBidE8).toBe(0n)
    expect(o.session).toBe('WEEKEND')
  })
})
