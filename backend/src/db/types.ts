// Row shapes as they come back from Postgres: NUMERIC as strings, TIMESTAMPTZ as Date.

import type { RiskState } from '../risk/risk-rules'

export type PolicyStatus =
  | 'VALIDATING'
  | 'READY'
  | 'OPENING'
  | 'ACTIVE'
  | 'PARTIAL'
  | 'WAIT_REOPEN'
  | 'WAIT_CONVERGENCE'
  | 'REDUCING'
  | 'EMERGENCY'
  | 'EXPIRED'
  | 'CLOSING'
  | 'CLOSED'
  | 'FAILED'

export const TERMINAL_STATUSES: readonly PolicyStatus[] = ['CLOSED', 'FAILED']

/** Statuses in which a short is open and must be watched. */
export const HEDGED_STATUSES: readonly PolicyStatus[] = [
  'ACTIVE',
  'PARTIAL',
  'WAIT_REOPEN',
  'WAIT_CONVERGENCE',
  'REDUCING',
  'EMERGENCY',
  'EXPIRED',
  'CLOSING',
]

export type ProtectionMode = 'TONIGHT' | 'WEEKEND' | 'CUSTOM' | 'WINDOW'
export type CloseReason = 'CONVERGED' | 'MANUAL' | 'EMERGENCY' | 'EXPIRED' | 'WINDOW_END'
/** CONVERGENCE waits for the oracle after the reopen; AT_END closes at the window end. */
export type CloseRule = 'CONVERGENCE' | 'AT_END'

export interface Policy {
  id: string
  status: PolicyStatus
  riskState: RiskState
  mode: ProtectionMode
  requestedProtectionBps: number
  actualProtectionBps: number
  startAt: Date
  reopenAt: Date
  maxEndAt: Date
  cooldownSec: number
  demoOverride: boolean
  closeReason: CloseReason | null
  failureReason: string | null
  ownerWallet: string
  receipt: Record<string, unknown> | null
  planRunId: string | null
  closeRule: CloseRule
  createdAt: Date
  updatedAt: Date
}

export type PlanStatus = 'ACTIVE' | 'CANCELLED' | 'COMPLETED'
export type PlanRunStatus = 'SCHEDULED' | 'SKIPPED' | 'OPENING' | 'OPEN' | 'DONE' | 'FAILED'

export interface Plan {
  id: string
  ownerWallet: string
  status: PlanStatus
  windowKind: 'PRE_MARKET' | 'POST_MARKET' | 'OVERNIGHT' | 'CUSTOM'
  customStart: string | null
  customEnd: string | null
  protectionBps: number
  stockSymbols: string[]
  startDate: string
  days: number
  createdAt: Date
  updatedAt: Date
}

export interface PlanRun {
  id: string
  planId: string
  runDate: string
  windowStart: Date | null
  windowEnd: Date | null
  closeRule: CloseRule
  status: PlanRunStatus
  note: string | null
  results: Record<string, { policyId?: string; error?: string }> | null
  updatedAt: Date
}

export interface HedgeLeg {
  id: string
  policyId: string
  stockSymbol: string
  perpSymbol: string
  stockQuantity: string
  stockMarkPrice: string
  stockMarketValue: string
  collateralWeight: string
  collateralValue: string
  targetProtectionBps: number
  targetNotional: string
  targetQuantity: string
  actualQuantity: string
  openedQuantity: string
  existingShortQuantity: string
  accountLeverage: number
  entryPrice: string | null
  exitPrice: string | null
  exitStockPrice: string | null
  currentStockPrice: string | null
  currentPerpPrice: string | null
  pnl: string
  realizedPnl: string
  funding: string
  fees: string
  borrowCost: string
  openingImr: string | null
  openingMmr: string | null
  currentMmr: string | null
  openClientId: number | null
  closeClientId: number | null
  basisBps: string | null
  convergenceCount: number
  status: PolicyStatus
  openedAt: Date | null
  closedAt: Date | null
}

export interface PolicyWithLeg {
  policy: Policy
  leg: HedgeLeg
}

export interface PolicyEvent {
  id: number
  policyId: string
  at: Date
  fromStatus: PolicyStatus | null
  toStatus: PolicyStatus
  detail: Record<string, unknown> | null
}

export type OrderPurpose = 'OPEN' | 'CLOSE' | 'REDUCE'
export type OrderRecordStatus = 'PENDING' | 'FILLED' | 'PARTIAL' | 'UNFILLED' | 'REJECTED' | 'UNKNOWN'

export interface OrderRecord {
  id: number
  policyId: string
  logicalId: string
  clientId: number
  purpose: OrderPurpose
  symbol: string
  side: 'Bid' | 'Ask'
  reduceOnly: boolean
  quantity: string
  price: string | null
  status: OrderRecordStatus
  backpackOrderId: string | null
  executedQuantity: string
  avgPrice: string | null
  fee: string
  feeSymbol: string | null
  error: string | null
  createdAt: Date
  updatedAt: Date
}

export type AttestationMode = 'SIMULATION' | 'DON'

export interface Attestation {
  id: number
  reportHash: string
  mode: AttestationMode
  rawReport: string
  context: string
  signatures: string[]
  validSignatures: number
  workflowId: string | null
  workflowOwner: string | null
  observedAt: Date
  payload: Record<string, unknown>
  receivedAt: Date
}

export interface ConvergenceCheck {
  id: number
  policyId: string
  attestationId: number
  observedAt: Date
  basisBps: string
  session: string
  passed: boolean
  counted: boolean
  rejectReason: string | null
  countAfter: number
}

export type AnchorKind = 'OPENED' | 'CONVERGED' | 'RECEIPT'

export interface Anchor {
  id: number
  policyId: string
  kind: AnchorKind
  digest: string
  memo: string
  status: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'SKIPPED'
  signature: string | null
  error: string | null
  createdAt: Date
}

export interface PnlPoint {
  id: number
  policyId: string
  at: Date
  stockPrice: string
  perpPrice: string
  underlyingPnl: string
  hedgePnl: string
  costs: string
  net: string
}
