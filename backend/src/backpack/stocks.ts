import { z } from 'zod'
import type { StockHoliday, StockSession } from '@prox/core'
import type { BackpackClient } from './client'

const SecuritySchema = z.looseObject({
  asset: z.string(),
  name: z.string(),
  sessions: z.array(z.looseObject({ name: z.string(), minQuantity: z.string(), maxQuantity: z.string(), stepSize: z.string() })),
})
export type Security = z.infer<typeof SecuritySchema>

const SessionSchema = z.looseObject({
  name: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  startWeekday: z.number(),
  endWeekday: z.number(),
  timezone: z.string(),
})

const HolidaySchema = z.looseObject({
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  name: z.string(),
  timezone: z.string(),
})

const IndicativeQuoteSchema = z.looseObject({
  available: z.boolean(),
  symbol: z.string(),
  side: z.enum(['Bid', 'Ask']),
  session: z.string().nullish(),
  reason: z.string().nullish(),
  /** Limit price: the RFQ settles at this price or better. */
  price: z.string().nullish(),
  /** Expected settle price when the quoter hedges at the current market. */
  estimatedPrice: z.string().nullish(),
  publishedAt: z.number(),
  quantityFilter: z.looseObject({ minQuantity: z.string(), maxQuantity: z.string(), stepSize: z.string() }).nullish(),
})
export type IndicativeQuote = z.infer<typeof IndicativeQuoteSchema>

const REFERENCE_TTL_MS = 10 * 60_000

/** Backpack's stock reference data: tradable securities, session hours, closures and live quotes. */
export class StocksApi {
  private securitiesCache: { at: number; value: Security[] } | null = null
  private calendarCache: { at: number; sessions: StockSession[]; holidays: StockHoliday[] } | null = null

  constructor(private readonly client: BackpackClient) {}

  async securities(): Promise<Security[]> {
    if (this.securitiesCache && Date.now() - this.securitiesCache.at < REFERENCE_TTL_MS) return this.securitiesCache.value
    const value = z.array(SecuritySchema).parse(await this.client.public('/api/v1/securities'))
    this.securitiesCache = { at: Date.now(), value }
    return value
  }

  /** Session hours and closure windows, the input of the session engine in @prox/core. */
  async calendar(): Promise<{ sessions: StockSession[]; holidays: StockHoliday[] }> {
    if (this.calendarCache && Date.now() - this.calendarCache.at < REFERENCE_TTL_MS) return this.calendarCache
    const [sessions, holidays] = await Promise.all([
      this.client.public('/api/v1/stockSessions'),
      this.client.public('/api/v1/stockHolidays'),
    ])
    this.calendarCache = {
      at: Date.now(),
      sessions: z.array(SessionSchema).parse(sessions),
      holidays: z.array(HolidaySchema).parse(holidays),
    }
    return this.calendarCache
  }

  /** What the stock quoter would quote now. `side` is ours: Bid buys the stock, Ask sells it. */
  async indicativeQuote(symbol: string, side: 'Bid' | 'Ask', quantity: string): Promise<IndicativeQuote> {
    const raw = await this.client.public('/api/v1/stockIndicativeQuote', { symbol, side, quantity })
    return IndicativeQuoteSchema.parse(raw)
  }
}
