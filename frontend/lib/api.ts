// Typed calls to the ProX backend. Cookies carry the session, so every call sends credentials.

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly blockers: string[] = [],
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const text = await response.text()
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : null
  if (!response.ok) {
    const message = (body?.error as string | undefined) ?? `${response.status} ${response.statusText}`
    throw new ApiError(response.status, message, (body?.blockers as string[] | undefined) ?? [])
  }
  return body as T
}

const get = <T>(path: string) => request<T>(path)
const post = <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export type ProtectionMode = 'TONIGHT' | 'WEEKEND' | 'CUSTOM'
export type RiskState = 'SAFE' | 'WATCH' | 'RISK' | 'REDUCE' | 'EMERGENCY'

export interface Health {
  ok: boolean
  tradingEnabled: boolean
  demoMode: boolean
  creMode: 'simulation' | 'don'
  creSimulation: { at: string; ok: boolean; detail: string } | null
  anchoring: boolean
  socket: boolean
  session: SessionSnapshot
}

export interface SessionSnapshot {
  state: 'PREMARKET' | 'REGULAR' | 'POSTMARKET' | 'OVERNIGHT' | 'WEEKEND' | 'HOLIDAY'
  sessionName: string | null
  holidayName: string | null
  at: string
  nextRegularOpen: string | null
  nextWeekendStart: string | null
}

export interface AccountHealth {
  portfolioValue: string
  netEquity: string
  netEquityAvailable: string
  netEquityLocked: string
  borrowLiability: string
  pnlUnrealized: string
  imr: string
  mmr: string
  maintenanceMargin: string
  risk: RiskState
  leverageLimit: string
  futuresTakerFeeRate: string
  liquidating: boolean
}

export interface Holding {
  symbol: string
  name: string
  quantity: string
  markPrice: string
  marketValue: string
  collateralWeight: string
  collateralValue: string
}

export interface Portfolio {
  holdings: Holding[]
  otherAssets: { symbol: string; quantity: string; marketValue: string; collateralValue: string }[]
  positions: { symbol: string; netQuantity: string; entryPrice: string; markPrice: string; pnlUnrealized: string }[]
  health: AccountHealth
  fetchedAt: string
}

export interface MarketRow extends Holding {
  perpSymbol: string | null
  perpMarkPrice: string | null
  minQuantity: string | null
  stepSize: string | null
  eligible: boolean
  reasons: string[]
  presets: { bps: number; available: boolean; reason: string | null; quantity?: string }[]
}

export interface Preview {
  stockSymbol: string
  stockName: string
  perpSymbol: string
  mode: ProtectionMode
  stockQuantity: string
  stockMarkPrice: string
  stockValue: string
  collateralWeight: string
  collateralValue: string
  perpMarkPrice: string
  perpIndexPrice: string
  requestedProtectionBps: number
  safeProtectionBps: number
  targetNotional: string
  targetQuantity: string
  existingShortQuantity: string
  orderQuantity: string
  orderLimitPrice: string
  maxOrderQuantity: string
  netExposureAfter: string
  leverage: number | null
  initialMargin: string | null
  projectedMmr: string | null
  projectedRisk: RiskState | null
  account: AccountHealth
  costs: { tradingFeeRoundTrip: string; fundingRateHourly: string | null; borrowInterest: 'variable' }
  session: SessionSnapshot
  reopenAt: string
  maxEndAt: string
  cooldownSec: number
  canActivate: boolean
  blockers: string[]
}

export interface Policy {
  id: string
  status: string
  riskState: RiskState
  mode: ProtectionMode
  requestedProtectionBps: number
  actualProtectionBps: number
  startAt: string
  reopenAt: string
  maxEndAt: string
  cooldownSec: number
  demoOverride: boolean
  closeReason: string | null
  failureReason: string | null
  ownerWallet: string
  receipt: Receipt | null
  planRunId: string | null
  closeRule: 'CONVERGENCE' | 'AT_END'
  createdAt: string
  updatedAt: string
}

export interface Leg {
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
  basisBps: string | null
  convergenceCount: number
  status: string
  openedAt: string | null
  closedAt: string | null
}

export interface PolicyWithLeg {
  policy: Policy
  leg: Leg
}

export interface PolicyDetail extends PolicyWithLeg {
  events: { id: number; at: string; fromStatus: string | null; toStatus: string; detail: Record<string, unknown> | null }[]
  orders: { id: number; purpose: string; side: string; quantity: string; price: string | null; status: string; executedQuantity: string; avgPrice: string | null; fee: string; backpackOrderId: string | null; error: string | null; createdAt: string }[]
  checks: { id: number; observedAt: string; basisBps: string; session: string; passed: boolean; counted: boolean; rejectReason: string | null; countAfter: number }[]
  anchors: Anchor[]
  pnl: PnlPoint[]
}

export interface Anchor {
  id: number
  kind: 'OPENED' | 'CONVERGED' | 'RECEIPT'
  digest: string
  memo: string
  status: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'SKIPPED'
  signature: string | null
  error: string | null
  createdAt: string
}

export interface PnlPoint {
  at: string
  stockPrice: string
  perpPrice: string
  underlyingPnl: string
  hedgePnl: string
  costs: string
  net: string
}

export interface PolicyHealth {
  policyId: string
  status: string
  riskState: RiskState
  portfolioValue: string
  netEquity: string
  netEquityAvailable: string
  imr: string
  mmr: string
  borrowLiability: string
  executionLeverage: number
  accountLeverageLimit: string
  basisBps: string | null
  convergenceCount: number
}

export interface Receipt {
  asset: string
  protectionBps: number
  durationSec: number
  openedAt: string
  closedAt: string
  closeReason: string
  stockQuantity: string
  startingStockPrice: string
  endingStockPrice: string
  startingStockValue: string
  endingStockValue: string
  underlyingPnl: string
  hedgeQuantity: string
  entryPrice: string
  exitPrice: string
  hedgePnl: string
  funding: string
  fees: string
  borrowInterest: string
  netProtectedValue: string
  trackingDifference: string
  orders: { purpose: string; side: string; quantity: string; avgPrice: string | null; fee: string; backpackOrderId: string | null }[]
}

export type WindowKind = 'PRE_MARKET' | 'POST_MARKET' | 'OVERNIGHT' | 'CUSTOM'

export interface PlanRequest {
  stockSymbols: string[]
  protectionBps: number
  window: { kind: WindowKind; customStart?: string; customEnd?: string }
  days: number
  startDate?: string
}

export interface PlanPreview {
  startDate: string
  runs: { date: string; startIso: string | null; endIso: string | null; closeRule: 'AT_END' | 'CONVERGENCE'; skipped?: string }[]
  stocks: { symbol: string; name: string; quantity: string; notional: string; issues: string[] }[]
  totalNotionalPerRun: string
  canCreate: boolean
  blockers: string[]
}

export interface Plan {
  id: string
  ownerWallet: string
  status: 'ACTIVE' | 'CANCELLED' | 'COMPLETED'
  windowKind: WindowKind
  customStart: string | null
  customEnd: string | null
  protectionBps: number
  stockSymbols: string[]
  startDate: string
  days: number
  createdAt: string
  updatedAt: string
}

export interface PlanRun {
  id: string
  planId: string
  runDate: string
  windowStart: string | null
  windowEnd: string | null
  closeRule: 'AT_END' | 'CONVERGENCE'
  status: 'SCHEDULED' | 'SKIPPED' | 'OPENING' | 'OPEN' | 'DONE' | 'FAILED'
  note: string | null
  results: Record<string, { policyId?: string; error?: string }> | null
  updatedAt: string
}

export interface PlanDetail {
  plan: Plan
  runs: PlanRun[]
  policies: PolicyWithLeg[]
}

export const api = {
  planPreview: (body: PlanRequest) => post<PlanPreview>('/api/plans/preview', body),
  createPlan: (body: PlanRequest) => post<{ plan: Plan; runs: PlanRun[] }>('/api/plans', body),
  plans: () => get<Plan[]>('/api/plans'),
  plan: (id: string) => get<PlanDetail>(`/api/plans/${id}`),
  cancelPlan: (id: string) => post<{ plan: Plan; runs: PlanRun[] }>(`/api/plans/${id}/cancel`),
  health: () => get<Health>('/api/health'),
  me: () => get<{ wallet: string | null }>('/api/auth/me'),
  challenge: (publicKey: string) => post<{ challenge: string; message: string }>('/api/auth/challenge', { publicKey }),
  verify: (body: { publicKey: string; challenge: string; signature: string }) => post<{ wallet: string }>('/api/auth/verify', body),
  logout: () => post<{ ok: true }>('/api/auth/logout'),
  portfolio: () => get<Portfolio>('/api/portfolio'),
  session: () => get<SessionSnapshot>('/api/session'),
  markets: () => get<MarketRow[]>('/api/protection/markets'),
  preview: (body: { stockSymbol: string; protectionBps: number; mode: ProtectionMode; customEndAt?: string }) => post<Preview>('/api/protection/preview', body),
  activate: (body: { stockSymbol: string; protectionBps: number; mode: ProtectionMode; customEndAt?: string }) => post<PolicyWithLeg>('/api/protection', body),
  policies: () => get<PolicyWithLeg[]>('/api/protection'),
  policy: (id: string) => get<PolicyDetail>(`/api/protection/${id}`),
  policyHealth: (id: string) => get<PolicyHealth>(`/api/protection/${id}/health`),
  close: (id: string) => post<PolicyWithLeg>(`/api/protection/${id}/close`),
  receipt: (id: string) => get<{ receipt: Receipt; anchors: Anchor[]; policy: Policy; leg: Leg }>(`/api/protection/${id}/receipt`),
  demoReopen: (policyId: string) => post<PolicyWithLeg>('/api/demo/reopen', { policyId }),
  advanced: () => get<Record<string, unknown>>('/api/account/advanced'),
}
