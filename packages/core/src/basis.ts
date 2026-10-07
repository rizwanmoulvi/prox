// Fixed-point price math with 8 decimals, safe for the CRE WASM runtime (no floats, no deps).

const SCALE = 100_000_000n
const DECIMALS = 8

/** Parse a decimal string such as "239.64" into an integer scaled by 1e8. Extra digits are cut. */
export function toE8(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim())
  if (!match) throw new Error(`Not a decimal number: ${value}`)
  const [, sign, whole, fraction = ''] = match
  const scaled = BigInt(whole!) * SCALE + BigInt(fraction.slice(0, DECIMALS).padEnd(DECIMALS, '0'))
  return sign === '-' ? -scaled : scaled
}

export function fromE8(value: bigint): string {
  const negative = value < 0n
  const abs = negative ? -value : value
  const fraction = (abs % SCALE).toString().padStart(DECIMALS, '0').replace(/0+$/, '')
  const text = fraction ? `${abs / SCALE}.${fraction}` : `${abs / SCALE}`
  return negative ? `-${text}` : text
}

export function midE8(a: bigint, b: bigint): bigint {
  return (a + b) / 2n
}

/**
 * PRD section 32: basisBps = |perp - reference| / reference x 10,000.
 * Returned in hundredths of a basis point so it stays an integer.
 */
export function basisCentiBps(perpE8: bigint, referenceE8: bigint): bigint {
  if (referenceE8 <= 0n) throw new Error('Reference price must be positive')
  const diff = perpE8 > referenceE8 ? perpE8 - referenceE8 : referenceE8 - perpE8
  return (diff * 1_000_000n) / referenceE8
}

export function centiBpsToBps(centiBps: bigint | number): number {
  return Number(centiBps) / 100
}
