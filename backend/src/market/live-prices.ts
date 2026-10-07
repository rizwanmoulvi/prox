// Latest prices for the perps and stocks under watch. Fed by the WebSocket, refreshed over REST
// when a value is stale, so a dropped socket degrades to slower data rather than wrong data.

import type { Backpack, BackpackSocket } from '../backpack'

export interface PerpQuote {
  markPrice: string
  indexPrice: string
  fundingRate: string | null
  bestBid: string | null
  bestAsk: string | null
  at: number
}

export interface StockQuote {
  /** Estimated settle price for a seller of the stock. */
  bid: string | null
  /** Estimated settle price for a buyer of the stock. */
  ask: string | null
  mid: string | null
  session: string | null
  at: number
}

const FRESH_MS = 15_000

export class LivePrices {
  private readonly perps = new Map<string, PerpQuote>()
  private readonly books = new Map<string, { bestBid: string | null; bestAsk: string | null; at: number }>()
  private readonly stocks = new Map<string, StockQuote>()

  constructor(
    private readonly backpack: Backpack,
    private readonly socket: BackpackSocket,
  ) {
    socket.on('data', (stream: string, data: Record<string, unknown>) => this.ingest(stream, data))
  }

  watchPerp(symbol: string): void {
    this.socket.subscribe([`markPrice.${symbol}`, `bookTicker.${symbol}`])
  }

  watchStock(stockSymbol: string): void {
    this.socket.subscribe([`stockIndicativeQuote.${bareTicker(stockSymbol)}`])
  }

  async perp(symbol: string): Promise<PerpQuote> {
    const cached = this.perps.get(symbol)
    const book = this.books.get(symbol)
    if (cached && isFresh(cached.at) && book && isFresh(book.at)) return { ...cached, ...book }
    const [mark, top] = await Promise.all([this.backpack.markets.markPrice(symbol), this.backpack.markets.topOfBook(symbol)])
    const quote = { markPrice: mark.markPrice, indexPrice: mark.indexPrice, fundingRate: mark.fundingRate, ...top, at: Date.now() }
    this.perps.set(symbol, quote)
    this.books.set(symbol, { bestBid: top.bestBid, bestAsk: top.bestAsk, at: quote.at })
    return quote
  }

  /** The cash quote for a stock. `mid` is null when the quoter offers no price right now. */
  async stock(stockSymbol: string): Promise<StockQuote> {
    const cached = this.stocks.get(stockSymbol)
    if (cached && isFresh(cached.at)) return cached
    // One share is accepted in every session, so it works as the probe size.
    const [sell, buy] = await Promise.all([
      this.backpack.stocks.indicativeQuote(stockSymbol, 'Ask', '1'),
      this.backpack.stocks.indicativeQuote(stockSymbol, 'Bid', '1'),
    ])
    const bid = sell.available ? (sell.estimatedPrice ?? sell.price ?? null) : null
    const ask = buy.available ? (buy.estimatedPrice ?? buy.price ?? null) : null
    const quote: StockQuote = { bid, ask, mid: midOf(bid, ask), session: sell.session ?? buy.session ?? null, at: Date.now() }
    this.stocks.set(stockSymbol, quote)
    return quote
  }

  private ingest(stream: string, data: Record<string, unknown>): void {
    const [kind, ...rest] = stream.split('.')
    const symbol = rest.join('.')
    const at = Date.now()
    if (kind === 'markPrice') {
      const previous = this.perps.get(symbol)
      this.perps.set(symbol, {
        markPrice: String(data.p),
        indexPrice: String(data.i),
        fundingRate: data.f == null ? null : String(data.f),
        bestBid: previous?.bestBid ?? null,
        bestAsk: previous?.bestAsk ?? null,
        at,
      })
    } else if (kind === 'bookTicker') {
      this.books.set(symbol, { bestBid: data.b == null ? null : String(data.b), bestAsk: data.a == null ? null : String(data.a), at })
    } else if (kind === 'stockIndicativeQuote') {
      const bid = data.estimatedBid == null ? null : String(data.estimatedBid)
      const ask = data.estimatedAsk == null ? null : String(data.estimatedAsk)
      const stockSymbol = [...this.stocks.keys()].find((s) => bareTicker(s) === symbol) ?? `${symbol}.US`
      this.stocks.set(stockSymbol, { bid, ask, mid: midOf(bid, ask), session: data.session == null ? null : String(data.session), at })
    }
  }
}

/** Backpack's stock streams use the bare ticker: NVDA.US becomes NVDA, BRK.B.US becomes BRK.B. */
export function bareTicker(stockSymbol: string): string {
  return stockSymbol.replace(/\.[A-Z]+$/, '')
}

function midOf(bid: string | null, ask: string | null): string | null {
  if (bid === null || ask === null) return null
  return ((Number(bid) + Number(ask)) / 2).toFixed(8).replace(/\.?0+$/, '')
}

function isFresh(at: number): boolean {
  return Date.now() - at < FRESH_MS
}
