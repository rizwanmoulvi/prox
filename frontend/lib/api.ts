// Typed calls to the ProX backend. Cookies carry the session, so every call sends credentials.

// Every call goes to this site's own /api, which next.config.ts forwards to the backend.
export const API_URL = ''

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
    // Only a request with a body is JSON. Fastify rejects an empty body sent as JSON, which is
    // what the bodyless POSTs (stop a schedule, close a hedge, sign out) used to do.
    headers: { ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
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

// Response shapes come from the backend's own types, so a renamed field fails the typecheck here.
// Wire<T> is what JSON does to them: every Date arrives as an ISO string.
type Wire<T> = T extends Date ? string : T extends (infer U)[] ? Wire<U>[] : T extends object ? { [K in keyof T]: Wire<T[K]> } : T

export type { ProtectionMode } from '../../backend/src/db/types'
export type { RiskState } from '../../backend/src/risk/risk-rules'
export type { Receipt } from '../../backend/src/protection/receipt'
import type { ProtectionMode } from '../../backend/src/db/types'
import type * as Db from '../../backend/src/db/types'
import type { RiskState } from '../../backend/src/risk/risk-rules'
import type { Receipt } from '../../backend/src/protection/receipt'
import type { ProtectionPreview } from '../../backend/src/protection/protection.preview'
import type { AccountHealth as BackendAccountHealth, Portfolio as BackendPortfolio, StockHolding } from '../../backend/src/portfolio/portfolio.service'
import type { SessionSnapshot as BackendSessionSnapshot } from '../../backend/src/market/market-session.service'
import type { PlanPreview as BackendPlanPreview, PlanRequest as BackendPlanRequest } from '../../backend/src/plans/plan.service'

export type SessionSnapshot = Wire<BackendSessionSnapshot>
export type AccountHealth = Wire<BackendAccountHealth>
export type Holding = Wire<StockHolding>
export type Portfolio = Wire<BackendPortfolio>
export type Preview = Wire<ProtectionPreview>
export type Policy = Omit<Wire<Db.Policy>, 'receipt'> & { receipt: Receipt | null }
export type Leg = Wire<Db.HedgeLeg>
export type Anchor = Wire<Db.Anchor>
/** Live points from the stream carry no row id, so the chart type leaves it out. */
export type PnlPoint = Omit<Wire<Db.PnlPoint>, 'id' | 'policyId'>
export type Attestation = Wire<Db.Attestation>
export type Plan = Wire<Db.Plan>
export type PlanRun = Wire<Db.PlanRun>
export type PlanRequest = BackendPlanRequest
export type PlanPreview = Wire<BackendPlanPreview>
export type WindowKind = Plan['windowKind']

export interface PlanDetail {
  plan: Plan
  runs: PlanRun[]
  policies: PolicyWithLeg[]
}

export interface PolicyWithLeg {
  policy: Policy
  leg: Leg
}

export interface PolicyDetail extends PolicyWithLeg {
  events: Wire<Db.PolicyEvent>[]
  orders: Wire<Db.OrderRecord>[]
  checks: Wire<Db.ConvergenceCheck>[]
  anchors: Anchor[]
  pnl: PnlPoint[]
}

// The three shapes below are built inline in backend/src/api/routes.ts, so they are declared here.

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

export interface MarketRow extends Holding {
  perpSymbol: string | null
  perpMarkPrice: string | null
  minQuantity: string | null
  stepSize: string | null
  eligible: boolean
  reasons: string[]
  presets: { bps: number; available: boolean; reason: string | null; quantity?: string }[]
}

export interface PolicyHealth {
  policyId: string
  status: Db.PolicyStatus
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

export interface ProtectRequest {
  stockSymbol: string
  protectionBps: number
  mode: ProtectionMode
  customEndAt?: string
}

export const api = {
  health: () => get<Health>('/api/health'),
  me: () => get<{ wallet: string | null }>('/api/auth/me'),
  challenge: (publicKey: string) => post<{ challenge: string; message: string }>('/api/auth/challenge', { publicKey }),
  verify: (body: { publicKey: string; challenge: string; signature: string }) => post<{ wallet: string }>('/api/auth/verify', body),
  logout: () => post<{ ok: true }>('/api/auth/logout'),
  portfolio: () => get<Portfolio>('/api/portfolio'),
  markets: () => get<MarketRow[]>('/api/protection/markets'),
  preview: (body: ProtectRequest) => post<Preview>('/api/protection/preview', body),
  activate: (body: ProtectRequest) => post<PolicyWithLeg>('/api/protection', body),
  policies: () => get<PolicyWithLeg[]>('/api/protection'),
  policy: (id: string) => get<PolicyDetail>(`/api/protection/${id}`),
  policyHealth: (id: string) => get<PolicyHealth>(`/api/protection/${id}/health`),
  close: (id: string) => post<PolicyWithLeg>(`/api/protection/${id}/close`),
  receipt: (id: string) => get<{ receipt: Receipt; anchors: Anchor[]; policy: Policy; leg: Leg }>(`/api/protection/${id}/receipt`),
  demoReopen: (policyId: string) => post<PolicyWithLeg>('/api/demo/reopen', { policyId }),
  attestations: () => get<Attestation[]>('/api/attestations'),
  // Scheduled protection: several stocks, a recurring window, a number of days.
  planPreview: (body: PlanRequest) => post<PlanPreview>('/api/plans/preview', body),
  createPlan: (body: PlanRequest) => post<{ plan: Plan; runs: PlanRun[] }>('/api/plans', body),
  plans: () => get<Plan[]>('/api/plans'),
  plan: (id: string) => get<PlanDetail>(`/api/plans/${id}`),
  cancelPlan: (id: string) => post<{ plan: Plan; runs: PlanRun[] }>(`/api/plans/${id}/cancel`),
  advanced: () => get<Record<string, unknown>>('/api/account/advanced'),
}
