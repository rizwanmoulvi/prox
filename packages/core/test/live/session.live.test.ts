import { expect, it } from 'vitest'
import { sessionAt, stateForSessionName, type StockHoliday, type StockSession } from '../../src/session'

const API = 'https://api.backpack.exchange'

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`)
  if (!response.ok) throw new Error(`${path} -> ${response.status}`)
  return (await response.json()) as T
}

// The venue reports its own live session on every indicative quote. Our engine, fed the
// venue's published sessions and holidays, must agree with it right now.
it('agrees with the session Backpack reports for NVDA.US at this moment', async () => {
  const [sessions, holidays, quote] = await Promise.all([
    get<StockSession[]>('/api/v1/stockSessions'),
    get<StockHoliday[]>('/api/v1/stockHolidays'),
    get<{ session: string | null; publishedAt: number }>('/api/v1/stockIndicativeQuote?symbol=NVDA.US&side=Bid&quantity=1'),
  ])
  const ours = sessionAt(quote.publishedAt, sessions, holidays)
  if (quote.session === null) {
    expect(['WEEKEND', 'HOLIDAY']).toContain(ours.state)
  } else {
    expect(ours.state).toBe(stateForSessionName(quote.session))
  }
})
