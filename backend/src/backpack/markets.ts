import { z } from 'zod'
import type { BackpackClient } from './client'

const MarginFunctionSchema = z.looseObject({ type: z.string(), base: z.string(), factor: z.string() })
export type MarginFunction = z.infer<typeof MarginFunctionSchema>

const MarketSchema = z.looseObject({
  symbol: z.string(),
  baseSymbol: z.string(),
  quoteSymbol: z.string(),
  marketType: z.string(),
  rwaMarketType: z.string().nullish(),
  orderBookState: z.string(),
  visible: z.boolean(),
  filters: z.looseObject({
    price: z.looseObject({ tickSize: z.string() }),
    quantity: z.looseObject({ minQuantity: z.string(), stepSize: z.string(), maxQuantity: z.string().nullish() }),
  }),
  imfFunction: MarginFunctionSchema.nullish(),
  mmfFunction: MarginFunctionSchema.nullish(),
})
export type Market = z.infer<typeof MarketSchema>

const MarkPriceSchema = z.looseObject({
  symbol: z.string(),
  markPrice: z.string(),
  indexPrice: z.string(),
  fundingRate: z.string(),
  nextFundingTimestamp: z.number(),
})
export type MarkPrice = z.infer<typeof MarkPriceSchema>

const DepthSchema = z.looseObject({
  bids: z.array(z.tuple([z.string(), z.string()])),
  asks: z.array(z.tuple([z.string(), z.string()])),
})

export interface TopOfBook {
  bestBid: string | null
  bestAsk: string | null
}

const MARKETS_TTL_MS = 60_000

export class MarketsApi {
  private cache: { at: number; markets: Market[] } | null = null

  constructor(private readonly client: BackpackClient) {}

  /** All order book markets. Cached for a minute because filters and states change rarely. */
  async list(): Promise<Market[]> {
    if (this.cache && Date.now() - this.cache.at < MARKETS_TTL_MS) return this.cache.markets
    const markets = z.array(MarketSchema).parse(await this.client.public('/api/v1/markets'))
    this.cache = { at: Date.now(), markets }
    return markets
  }

  async get(symbol: string): Promise<Market> {
    return MarketSchema.parse(await this.client.public('/api/v1/market', { symbol }))
  }

  async markPrice(symbol: string): Promise<MarkPrice> {
    const rows = z.array(MarkPriceSchema).parse(await this.client.public('/api/v1/markPrices', { symbol }))
    const row = rows.find((r) => r.symbol === symbol)
    if (!row) throw new Error(`No mark price for ${symbol}`)
    return row
  }

  /** Bids arrive ascending and asks ascending, so the touch is the last bid and the first ask. */
  async topOfBook(symbol: string): Promise<TopOfBook> {
    const depth = DepthSchema.parse(await this.client.public('/api/v1/depth', { symbol }))
    return { bestBid: depth.bids.at(-1)?.[0] ?? null, bestAsk: depth.asks[0]?.[0] ?? null }
  }
}
