// Shared singletons, built once in server.ts and handed to every service.

import type { FastifyBaseLogger } from 'fastify'
import type { Backpack, BackpackSocket } from './backpack'
import type { Config } from './config'
import type { AttestationRepo } from './db/attestations'
import type { Db } from './db/db'
import type { OrderRepo } from './db/orders'
import type { PlanRepo } from './db/plans'
import type { PolicyRepo } from './db/policies'
import type { EventBus } from './events'
import type { LivePrices } from './market/live-prices'
import type { MarketSessionService } from './market/market-session.service'
import type { PortfolioService } from './portfolio/portfolio.service'
import type { MemoAnchor } from './solana/memo-anchor'

export interface Context {
  config: Config
  log: FastifyBaseLogger
  backpack: Backpack
  socket: BackpackSocket
  prices: LivePrices
  db: Db
  policies: PolicyRepo
  plans: PlanRepo
  orders: OrderRepo
  attestations: AttestationRepo
  sessions: MarketSessionService
  portfolio: PortfolioService
  events: EventBus
  anchor: MemoAnchor | null
}
