// Wires everything together and starts the API, the Backpack socket and the workers.

import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import Fastify from 'fastify'
import { ZodError } from 'zod'
import { registerRoutes } from './api/routes'
import { AuthError, SESSION_COOKIE, WalletAuth } from './auth/wallet-signin'
import { Backpack, BackpackApiError, BackpackSocket, BackpackTimeoutError } from './backpack'
import { loadConfig, riskThresholds } from './config'
import type { Context } from './context'
import { ConvergenceService } from './convergence/convergence.service'
import { IngestRejected, ReportIngest } from './cre/report-ingest'
import { CreSimRunner } from './cre/sim-runner'
import { AttestationRepo } from './db/attestations'
import { Db } from './db/db'
import { OrderRepo } from './db/orders'
import { PlanRepo } from './db/plans'
import { PolicyRepo, StateConflictError } from './db/policies'
import { HEDGED_STATUSES } from './db/types'
import { EventBus } from './events'
import { HedgeExecutor } from './execution/hedge.executor'
import { LivePrices } from './market/live-prices'
import { MarketSessionService } from './market/market-session.service'
import { PortfolioService } from './portfolio/portfolio.service'
import { PreviewBlocked, PreviewService } from './protection/protection.preview'
import { ActivationBlocked, ProtectionService } from './protection/protection.service'
import { PlanBlocked, PlanService } from './plans/plan.service'
import { RiskService } from './risk/risk.service'
import { MemoAnchor } from './solana/memo-anchor'
import { MonitorWorker } from './workers/monitor.worker'
import { ReconcileWorker } from './workers/reconcile.worker'
import { ScheduleWorker } from './workers/schedule.worker'

const config = loadConfig()
const app = Fastify({
  logger: { level: 'info', redact: ['req.headers.cookie', 'req.headers["x-prox-ingest-token"]', 'req.headers["x-api-key"]'] },
  trustProxy: false,
})

const backpack = Backpack.create(config.BACKPACK_API_KEY, config.BACKPACK_PRIVATE_KEY)
await backpack.client.syncClock()
const socket = new BackpackSocket(backpack.client)
const db = new Db(config.DATABASE_URL)
await db.migrate()
const policies = new PolicyRepo(db)

const ctx: Context = {
  config,
  log: app.log,
  backpack,
  socket,
  prices: new LivePrices(backpack, socket),
  db,
  policies,
  plans: new PlanRepo(db),
  orders: new OrderRepo(db),
  attestations: new AttestationRepo(db),
  sessions: new MarketSessionService(backpack),
  portfolio: new PortfolioService(backpack, riskThresholds(config)),
  events: new EventBus(),
  anchor: MemoAnchor.fromConfig(config, policies, app.log),
}

const preview = new PreviewService(config, backpack, ctx.portfolio, ctx.prices, ctx.sessions, policies)
const executor = new HedgeExecutor(config, backpack, ctx.orders, ctx.prices)
const protection = new ProtectionService(ctx, preview, executor)
const convergence = new ConvergenceService(ctx, protection)
const ingest = new ReportIngest(ctx, convergence)
const simRunner = new CreSimRunner(ctx, ingest, () => convergence.watchlist())
const risk = new RiskService(ctx, protection)
const monitor = new MonitorWorker(ctx, protection, risk)
const reconcile = new ReconcileWorker(ctx, protection, executor)
const planService = new PlanService(ctx, ctx.plans, protection)
const schedule = new ScheduleWorker(ctx, planService)

await app.register(cors, { origin: config.FRONTEND_ORIGIN, credentials: true })
await app.register(cookie)
await app.register(jwt, { secret: config.SESSION_SECRET, cookie: { cookieName: SESSION_COOKIE, signed: false } })
const auth = new WalletAuth(app, config)
registerRoutes(app, { ctx, auth, preview, protection, convergence, ingest, simRunner, plans: planService })

app.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) return reply.code(400).send({ error: 'invalid request', issues: error.issues })
  if (error instanceof ActivationBlocked || error instanceof PreviewBlocked || error instanceof PlanBlocked) {
    return reply.code(409).send({ error: error.message, blockers: error.blockers })
  }
  if (error instanceof StateConflictError) return reply.code(409).send({ error: error.message })
  if (error instanceof AuthError) return reply.code(401).send({ error: error.message })
  if (error instanceof IngestRejected) return reply.code(error.status).send({ error: error.message })
  if (error instanceof BackpackApiError) return reply.code(502).send({ error: error.message, backpackCode: error.code })
  if (error instanceof BackpackTimeoutError) return reply.code(504).send({ error: error.message })
  request.log.error({ err: error }, 'unhandled error')
  return reply.code(500).send({ error: (error as Error).message })
})

// Resume anything interrupted before taking traffic, then keep the live legs' prices flowing.
socket.connect()
socket.subscribe(['account.positionUpdate', 'account.orderUpdate', 'account.balanceUpdate'])
await reconcile.runOnce().catch((err) => app.log.error({ err }, 'startup reconciliation failed'))
for (const item of await policies.listLive()) {
  if (!HEDGED_STATUSES.includes(item.policy.status)) continue
  ctx.prices.watchPerp(item.leg.perpSymbol)
  ctx.prices.watchStock(item.leg.stockSymbol)
}
monitor.start()
reconcile.start()
simRunner.start()
schedule.start()
setInterval(() => void backpack.client.syncClock().catch(() => undefined), 10 * 60_000)

await app.listen({ port: config.PORT, host: '127.0.0.1' })
app.log.info(
  { trading: config.TRADING_ENABLED, demo: config.DEMO_MODE, cre: config.CRE_REPORT_MODE, anchoring: ctx.anchor !== null },
  'ProX backend ready',
)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    monitor.stop()
    reconcile.stop()
    simRunner.stop()
    schedule.stop()
    socket.close()
    void app.close().then(() => db.close()).then(() => process.exit(0))
  })
}
