import { describe, expect, it } from 'vitest'
import { basisCentiBps, centiBpsToBps, fromE8, midE8, toE8 } from '../src/basis'
import { decodeOracleReport, encodeOracleReport, type OracleReport } from '../src/report-codec'

describe('fixed-point prices', () => {
  it('parses and prints decimals exactly', () => {
    expect(toE8('239.64')).toBe(23_964_000_000n)
    expect(toE8('0.01')).toBe(1_000_000n)
    expect(fromE8(toE8('239.49828'))).toBe('239.49828')
    expect(fromE8(toE8('240'))).toBe('240')
    expect(fromE8(toE8('-1.5'))).toBe('-1.5')
  })

  it('rejects text that is not a decimal number', () => {
    expect(() => toE8('abc')).toThrow()
    expect(() => toE8('')).toThrow()
    expect(() => toE8('1e5')).toThrow()
  })

  it('takes the midpoint of two prices', () => {
    expect(fromE8(midE8(toE8('239.58'), toE8('239.72')))).toBe('239.65')
  })
})

// PRD section 32: basisBps = abs(perpPrice - referencePrice) / referencePrice x 10,000
describe('basisCentiBps', () => {
  it('is 50 bps when the perp is 0.5% above the reference', () => {
    expect(centiBpsToBps(basisCentiBps(toE8('100.5'), toE8('100')))).toBe(50)
  })

  it('is the same size when the perp is below the reference', () => {
    expect(centiBpsToBps(basisCentiBps(toE8('99.5'), toE8('100')))).toBe(50)
  })

  it('is zero when the prices match', () => {
    expect(basisCentiBps(toE8('240'), toE8('240'))).toBe(0n)
  })

  it('reproduces the PRD demo ladder (0.80%, 0.52%, 0.41%, 0.28%)', () => {
    const ref = toE8('200')
    expect(centiBpsToBps(basisCentiBps(toE8('201.6'), ref))).toBe(80)
    expect(centiBpsToBps(basisCentiBps(toE8('201.04'), ref))).toBe(52)
    expect(centiBpsToBps(basisCentiBps(toE8('200.82'), ref))).toBe(41)
    expect(centiBpsToBps(basisCentiBps(toE8('200.56'), ref))).toBe(28)
  })

  it('refuses a reference price that is not positive', () => {
    expect(() => basisCentiBps(toE8('1'), 0n)).toThrow()
  })
})

describe('oracle report codec', () => {
  it('decodes exactly what was encoded', () => {
    const report: OracleReport = {
      observedAtMs: 1_791_319_303_267n,
      observations: [
        {
          stockSymbol: 'NVDA.US',
          perpSymbol: 'NVDA.US_USDC_PERP',
          perpMarkE8: toE8('239.68'),
          perpIndexE8: toE8('239.64998'),
          stockBidE8: toE8('239.58'),
          stockAskE8: toE8('239.72'),
          referenceE8: toE8('239.65'),
          referenceSource: 'INDICATIVE_QUOTE',
          basisCentiBps: 125,
          session: 'POSTMARKET',
          quoteTimestampMs: 1_791_319_303_267n,
        },
      ],
    }
    expect(decodeOracleReport(encodeOracleReport(report))).toEqual(report)
  })

  it('round-trips an empty observation list', () => {
    const report: OracleReport = { observedAtMs: 1n, observations: [] }
    expect(decodeOracleReport(encodeOracleReport(report))).toEqual(report)
  })
})
