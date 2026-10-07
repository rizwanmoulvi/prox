import { describe, expect, it } from 'vitest'
import { Backpack, BackpackSocket } from '../../src/backpack'

// Read-only calls against the real exchange. No key needed.
const backpack = Backpack.create()

describe('Backpack public API', () => {
  it('lists an open NVDA perp with usable quantity filters', async () => {
    const market = (await backpack.markets.list()).find((m) => m.symbol === 'NVDA.US_USDC_PERP')
    expect(market).toBeDefined()
    expect(market!.marketType).toBe('PERP')
    expect(market!.baseSymbol).toBe('NVDA.US')
    expect(Number(market!.filters.quantity.minQuantity)).toBeGreaterThan(0)
    expect(Number(market!.filters.quantity.stepSize)).toBeGreaterThan(0)
    expect(market!.imfFunction).toBeTruthy()
  })

  it('returns a mark price, an index price and a two-sided book for the NVDA perp', async () => {
    const mark = await backpack.markets.markPrice('NVDA.US_USDC_PERP')
    expect(Number(mark.markPrice)).toBeGreaterThan(0)
    expect(Number(mark.indexPrice)).toBeGreaterThan(0)
    const book = await backpack.markets.topOfBook('NVDA.US_USDC_PERP')
    expect(Number(book.bestAsk)).toBeGreaterThan(Number(book.bestBid))
  })

  it('lists NVDA.US as a security and publishes a session calendar', async () => {
    const securities = await backpack.stocks.securities()
    expect(securities.some((s) => s.asset === 'NVDA.US')).toBe(true)
    const { sessions, holidays } = await backpack.stocks.calendar()
    expect(sessions.map((s) => s.name)).toContain('US_EQUITIES_REGULAR')
    expect(Array.isArray(holidays)).toBe(true)
  })

  it('answers an indicative quote request with a quote or a stated reason', async () => {
    const quote = await backpack.stocks.indicativeQuote('NVDA.US', 'Ask', '1')
    if (quote.available) expect(Number(quote.estimatedPrice ?? quote.price)).toBeGreaterThan(0)
    else expect(quote.reason).toBeTruthy()
  })

  it('reads the exchange clock within a few seconds of ours', async () => {
    expect(Math.abs(await backpack.client.syncClock())).toBeLessThan(5000)
  })
})

describe('Backpack public WebSocket', () => {
  it('streams mark prices for the NVDA perp', async () => {
    const socket = new BackpackSocket(backpack.client)
    const payload = await new Promise<{ s: string; p: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no mark price within 20s')), 20_000)
      socket.on('data', (stream: string, data: { s: string; p: string }) => {
        if (stream !== 'markPrice.NVDA.US_USDC_PERP') return
        clearTimeout(timer)
        resolve(data)
      })
      socket.subscribe(['markPrice.NVDA.US_USDC_PERP'])
      socket.connect()
    })
    socket.close()
    expect(payload.s).toBe('NVDA.US_USDC_PERP')
    expect(Number(payload.p)).toBeGreaterThan(0)
  })
})
