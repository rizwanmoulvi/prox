// HTTP surface from PRD section 38 plus the oracle, auth, demo and streaming routes.

import Decimal from 'decimal.js'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { WalletAuth } from '../auth/wallet-signin'
import type { Context } from '../context'
import type { ConvergenceService } from '../convergence/convergence.service'
import type { CreSimRunner } from '../cre/sim-runner'
import type { ReportIngest } from '../cre/report-ingest'
import { marginRates, riskStateFor } from '../risk/risk-rules'
import { riskThresholds } from '../config'
import { sizeHedge } from '../protection/protection.math'
import { findPerp, type PreviewService } from '../protection/protection.preview'
import type { ProtectionService } from '../protection/protection.service'
import type { PlanService } from '../plans/plan.service'

const PRESETS = [2500, 5000, 7500, 10_000] as const

const PreviewBody = z.object({
  stockSymbol: z.string().min(1),
  protectionBps: z.number().int().refine((v) => PRESETS.includes(v as (typeof PRESETS)[number]), 'protectionBps must be 2500, 5000, 7500 or 10000'),
  mode: z.enum(['TONIGHT', 'WEEKEND', 'CUSTOM']),
  customEndAt: z.string().datetime().optional(),
})
const GroupBody = PreviewBody.omit({ stockSymbol: true }).extend({ stockSymbols: z.array(z.string().min(1)).min(1).max(200) })
const ReportBody = z.object({ report: z.string().min(1), context: z.string().min(1), signatures: z.array(z.string()) })
const PolicyParams = z.object({ id: z.string().uuid() })
const PlanBody = z.object({
  stockSymbols: z.array(z.string().min(1)).min(1).max(200),
  protectionBps: z.number().int().refine((v) => PRESETS.includes(v as (typeof PRESETS)[number]), 'protectionBps must be 2500, 5000, 7500 or 10000'),
  window: z.object({
    kind: z.enum(['PRE_MARKET', 'POST_MARKET', 'OVERNIGHT', 'CUSTOM']),
    customStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    customEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    /** IANA zone the custom times are in. Absent means New York time. */
    timeZone: z.string().min(1).max(64).optional(),
  }),
  days: z.number().int().min(1).max(60),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})
const DemoBody = z.object({ policyId: z.string().uuid() })

export interface RouteDeps {
  ctx: Context
  auth: WalletAuth
  preview: PreviewService
  protection: ProtectionService
  convergence: ConvergenceService
  ingest: ReportIngest
  simRunner: CreSimRunner
  plans: PlanService
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { ctx, auth, preview, protection, convergence, ingest, simRunner, plans } = deps
  const operator = { preHandler: auth.requireSession }

  app.get('/api/health', async () => ({
    ok: true,
    tradingEnabled: ctx.config.TRADING_ENABLED,
    demoMode: ctx.config.DEMO_MODE,
    creMode: ctx.config.CRE_REPORT_MODE,
    creSimulation: simRunner.enabled ? simRunner.lastRun : null,
    anchoring: ctx.anchor !== null,
    socket: ctx.socket.connected,
    session: await ctx.sessions.current(),
  }))

  auth.routes()

  app.get('/api/portfolio', operator, async () => ctx.portfolio.get())

  app.get('/api/session', operator, async () => ctx.sessions.current())

  /** PRD section 10: every held stock with a perp, and which presets its size allows. */
  app.get('/api/protection/markets', operator, async () => {
    const [portfolio, markets, live] = await Promise.all([ctx.portfolio.get(), ctx.backpack.markets.list(), ctx.policies.listLive()])
    return Promise.all(
      portfolio.holdings.map(async (holding) => {
        const perp = findPerp(markets, holding.symbol)
        const reasons: string[] = []
        if (!ctx.config.ALLOWED_SYMBOLS.includes(holding.symbol)) reasons.push('not in ALLOWED_SYMBOLS')
        if (new Decimal(holding.collateralWeight).lte(0)) reasons.push('not accepted as collateral')
        if (!perp) reasons.push('no perpetual market')
        else if (perp.orderBookState !== 'Open') reasons.push(`order book ${perp.orderBookState}`)
        if (live.some((p) => p.leg.stockSymbol === holding.symbol)) reasons.push('protection already live')
        const perpQuote = perp ? await ctx.prices.perp(perp.symbol) : null
        const presets = PRESETS.map((bps) => {
          if (!perp || !perpQuote) return { bps, available: false, reason: 'no perp' }
          const sizing = sizeHedge({
            stockQuantity: holding.quantity,
            stockMarkPrice: holding.markPrice,
            perpMarkPrice: perpQuote.markPrice,
            protectionBps: bps,
            existingShortQuantity: 0,
            stepSize: perp.filters.quantity.stepSize,
            minQuantity: perp.filters.quantity.minQuantity,
          })
          return { bps, available: sizing.sizeIssue === null, reason: sizing.sizeIssue, quantity: sizing.targetQuantity.toString() }
        })
        return {
          ...holding,
          perpSymbol: perp?.symbol ?? null,
          perpMarkPrice: perpQuote?.markPrice ?? null,
          minQuantity: perp?.filters.quantity.minQuantity ?? null,
          stepSize: perp?.filters.quantity.stepSize ?? null,
          eligible: reasons.length === 0,
          reasons,
          presets,
        }
      }),
    )
  })

  app.post('/api/protection/preview', operator, async (request) => preview.preview(PreviewBody.parse(request.body)))

  app.post('/api/protection', operator, async (request, reply) => {
    const body = PreviewBody.parse(request.body)
    const created = await protection.activate(body, request.wallet!)
    return reply.code(201).send(created)
  })

  /** Several stocks at once: they must fit side by side under one leverage. */
  app.post('/api/protection/group/preview', operator, async (request) => {
    const body = GroupBody.parse(request.body)
    return preview.previewGroup(body.stockSymbols, body.protectionBps)
  })

  // ponytail: opens the stocks one after another inside the request; move to a background job if groups reach dozens.
  app.post('/api/protection/group', operator, async (request, reply) => {
    const { stockSymbols, ...rest } = GroupBody.parse(request.body)
    const results = await protection.activateMany(stockSymbols.map((stockSymbol) => ({ ...rest, stockSymbol })), request.wallet!)
    return reply.code(201).send(results)
  })

  app.get('/api/protection', operator, async () => ctx.policies.list())

  app.get('/api/protection/:id', operator, async (request, reply) => {
    const { id } = PolicyParams.parse(request.params)
    const found = await ctx.policies.get(id)
    if (!found) return reply.code(404).send({ error: 'unknown policy' })
    const [events, orders, checks, anchors, pnl] = await Promise.all([
      ctx.policies.events(id),
      ctx.orders.forPolicy(id),
      ctx.attestations.checksFor(id),
      ctx.policies.anchors(id),
      ctx.policies.pnlPoints(id),
    ])
    return { ...found, events, orders, checks, anchors, pnl }
  })

  /** PRD section 42: the health card. */
  app.get('/api/protection/:id/health', operator, async (request, reply) => {
    const { id } = PolicyParams.parse(request.params)
    const found = await ctx.policies.get(id)
    if (!found) return reply.code(404).send({ error: 'unknown policy' })
    const [collateral, account] = await Promise.all([ctx.backpack.collateral.get(), ctx.backpack.account.get()])
    const rates = marginRates(collateral)
    return {
      policyId: id,
      status: found.policy.status,
      riskState: riskStateFor(rates.mmr, riskThresholds(ctx.config)),
      portfolioValue: collateral.assetsValue,
      netEquity: collateral.netEquity,
      netEquityAvailable: collateral.netEquityAvailable,
      imr: rates.imr.toString(),
      mmr: rates.mmr.toString(),
      borrowLiability: collateral.borrowLiability,
      executionLeverage: found.leg.accountLeverage,
      accountLeverageLimit: account.leverageLimit,
      basisBps: found.leg.basisBps,
      convergenceCount: found.leg.convergenceCount,
    }
  })

  app.post('/api/protection/:id/close', operator, async (request) => {
    const { id } = PolicyParams.parse(request.params)
    return protection.close(id, 'MANUAL')
  })

  app.get('/api/protection/:id/receipt', operator, async (request, reply) => {
    const { id } = PolicyParams.parse(request.params)
    const found = await ctx.policies.get(id)
    if (!found) return reply.code(404).send({ error: 'unknown policy' })
    if (!found.policy.receipt) return reply.code(409).send({ error: `policy is ${found.policy.status}; no receipt yet` })
    const anchors = await ctx.policies.anchors(id)
    return { receipt: found.policy.receipt, anchors, policy: found.policy, leg: found.leg }
  })

  // Scheduled protection: several stocks, a recurring window, a span of days.
  app.post('/api/plans/preview', operator, async (request) => plans.preview(PlanBody.parse(request.body)))

  app.post('/api/plans', operator, async (request, reply) => {
    const created = await plans.create(PlanBody.parse(request.body), request.wallet!)
    return reply.code(201).send(created)
  })

  app.get('/api/plans', operator, async () => ctx.plans.list())

  app.get('/api/plans/:id', operator, async (request, reply) => {
    const { id } = PolicyParams.parse(request.params)
    const found = await plans.get(id)
    return found ?? reply.code(404).send({ error: 'unknown plan' })
  })

  app.post('/api/plans/:id/cancel', operator, async (request) => {
    const { id } = PolicyParams.parse(request.params)
    return plans.cancel(id)
  })

  app.post('/api/demo/reopen', operator, async (request) => {
    const { policyId } = DemoBody.parse(request.body)
    return protection.demoReopen(policyId)
  })

  app.get('/api/account/advanced', operator, async () => {
    const [account, collateral, positions, openOrders, balances] = await Promise.all([
      ctx.backpack.account.get(),
      ctx.backpack.collateral.get(),
      ctx.backpack.positions.list(),
      ctx.backpack.orders.open(),
      ctx.backpack.capital.balances(),
    ])
    return { account, collateral, positions, openOrders, balances, anchorBalanceLamports: await ctx.anchor?.balanceLamports().catch(() => null) }
  })

  app.get('/api/stream', operator, (request, reply) => {
    // Hand the socket to us: Fastify must not try to finish this response.
    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': ctx.config.FRONTEND_ORIGIN,
      'Access-Control-Allow-Credentials': 'true',
    })
    reply.raw.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`)
    const unsubscribe = ctx.events.subscribe((event) => reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15_000)
    request.raw.on('close', () => {
      unsubscribe()
      clearInterval(heartbeat)
    })
  })

  // Oracle routes. The watchlist is public and holds no secrets; the report route authenticates itself.
  app.get('/api/cre/watchlist', async () => ({ pairs: await convergence.watchlist() }))

  app.post('/api/cre/reports', async (request, reply) => {
    const body = ReportBody.parse(request.body)
    const token = request.headers['x-prox-ingest-token']
    const stored = await ingest.ingest(body, { ip: request.ip, token: Array.isArray(token) ? token[0] : token })
    return reply.code(stored ? 201 : 200).send({ accepted: !!stored, duplicate: !stored, hash: stored?.reportHash ?? null })
  })

  app.get('/api/attestations', operator, async () => ctx.attestations.latest())

  app.get('/api/attestations/:hash', async (request, reply) => {
    const { hash } = z.object({ hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).parse(request.params)
    const found = await ctx.attestations.byHash(hash)
    return found ?? reply.code(404).send({ error: 'unknown report' })
  })
}
