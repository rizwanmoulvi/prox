// The payload the CRE convergence oracle signs. The workflow encodes it, the backend decodes it.

import { decodeAbiParameters, encodeAbiParameters, type Hex } from 'viem'
import { SESSION_STATES, type SessionState } from './session'

export const REFERENCE_SOURCES = ['INDICATIVE_QUOTE', 'PERP_INDEX'] as const
export type ReferenceSource = (typeof REFERENCE_SOURCES)[number]

export interface OracleObservation {
  stockSymbol: string
  perpSymbol: string
  perpMarkE8: bigint
  perpIndexE8: bigint
  /** Price a seller of the stock receives now. Zero when no quote is available. */
  stockBidE8: bigint
  /** Price a buyer of the stock pays now. Zero when no quote is available. */
  stockAskE8: bigint
  referenceE8: bigint
  referenceSource: ReferenceSource
  basisCentiBps: number
  session: SessionState
  /** Publish time of the stock quote in Unix ms, zero when there was none. */
  quoteTimestampMs: bigint
}

export interface OracleReport {
  observedAtMs: bigint
  observations: OracleObservation[]
}

const REPORT_ABI = [
  { name: 'observedAtMs', type: 'uint64' },
  {
    name: 'observations',
    type: 'tuple[]',
    components: [
      { name: 'stockSymbol', type: 'string' },
      { name: 'perpSymbol', type: 'string' },
      { name: 'perpMarkE8', type: 'uint256' },
      { name: 'perpIndexE8', type: 'uint256' },
      { name: 'stockBidE8', type: 'uint256' },
      { name: 'stockAskE8', type: 'uint256' },
      { name: 'referenceE8', type: 'uint256' },
      { name: 'referenceSource', type: 'uint8' },
      { name: 'basisCentiBps', type: 'uint32' },
      { name: 'session', type: 'uint8' },
      { name: 'quoteTimestampMs', type: 'uint64' },
    ],
  },
] as const

export function encodeOracleReport(report: OracleReport): Hex {
  const observations = report.observations.map((o) => ({
    ...o,
    referenceSource: indexOf(REFERENCE_SOURCES, o.referenceSource),
    session: indexOf(SESSION_STATES, o.session),
  }))
  return encodeAbiParameters(REPORT_ABI, [report.observedAtMs, observations])
}

export function decodeOracleReport(payload: Hex): OracleReport {
  const [observedAtMs, observations] = decodeAbiParameters(REPORT_ABI, payload)
  return {
    observedAtMs,
    observations: observations.map((o) => ({
      ...o,
      referenceSource: valueAt(REFERENCE_SOURCES, o.referenceSource),
      session: valueAt(SESSION_STATES, o.session),
    })),
  }
}

function indexOf<T>(values: readonly T[], value: T): number {
  const index = values.indexOf(value)
  if (index < 0) throw new Error(`Unknown enum value: ${String(value)}`)
  return index
}

function valueAt<T>(values: readonly T[], index: number): T {
  const value = values[index]
  if (value === undefined) throw new Error(`Unknown enum index: ${index}`)
  return value
}
