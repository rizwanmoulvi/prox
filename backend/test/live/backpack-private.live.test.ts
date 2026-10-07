import { describe, expect, it } from 'vitest'
import { Backpack } from '../../src/backpack'
import { loadConfig } from '../../src/config'
import { PortfolioService } from '../../src/portfolio/portfolio.service'
import { riskThresholds } from '../../src/config'

// Read-only calls with the operator's Backpack key. Skipped when backend/.env has no key.
let config: ReturnType<typeof loadConfig> | null = null
try {
  config = loadConfig()
} catch {
  config = null
}

describe.skipIf(!config)('Backpack private API (read only)', () => {
  const backpack = Backpack.create(config?.BACKPACK_API_KEY, config?.BACKPACK_PRIVATE_KEY)

  it('authenticates and reads the account settings', async () => {
    await backpack.client.syncClock()
    const account = await backpack.account.get()
    expect(Number(account.leverageLimit)).toBeGreaterThan(0)
    expect(account.liquidating).toBe(false)
    // Logged (not asserted) so the fee unit can be checked against the first live fill.
    console.log('account fees (expected in bps):', { taker: account.futuresTakerFee, maker: account.futuresMakerFee, leverageLimit: account.leverageLimit })
  })

  it('reads collateral with a NVDA.US holding and margin fractions', async () => {
    const collateral = await backpack.collateral.get()
    expect(Number(collateral.netEquity)).toBeGreaterThan(0)
    const nvda = collateral.collateral.find((c) => c.symbol === 'NVDA.US')
    expect(nvda).toBeDefined()
    expect(Number(nvda!.totalQuantity)).toBeGreaterThan(0)
    console.log('NVDA.US collateral row:', nvda)
    console.log('account margin:', {
      netEquity: collateral.netEquity,
      netEquityAvailable: collateral.netEquityAvailable,
      imf: collateral.imf,
      mmf: collateral.mmf,
      marginFraction: collateral.marginFraction,
      borrowLiability: collateral.borrowLiability,
    })
  })

  it('reads balances, positions and open orders', async () => {
    const [balances, positions, orders] = await Promise.all([backpack.capital.balances(), backpack.positions.list(), backpack.orders.open()])
    expect(typeof balances).toBe('object')
    expect(Array.isArray(positions)).toBe(true)
    expect(Array.isArray(orders)).toBe(true)
    console.log('positions:', positions.map((p) => ({ symbol: p.symbol, netQuantity: p.netQuantity, entryPrice: p.entryPrice })))
  })

  it('asks Backpack for the maximum NVDA perp quantity this account may sell', async () => {
    const max = await backpack.orders.maxQuantity('NVDA.US_USDC_PERP', 'Ask')
    expect(Number(max)).toBeGreaterThanOrEqual(0)
    console.log('max sell quantity NVDA.US_USDC_PERP:', max)
  })

  it('builds the portfolio view the dashboard shows', async () => {
    const portfolio = await new PortfolioService(backpack, riskThresholds(config!)).get()
    expect(portfolio.holdings.some((h) => h.symbol === 'NVDA.US')).toBe(true)
    expect(['SAFE', 'WATCH', 'RISK', 'REDUCE', 'EMERGENCY']).toContain(portfolio.health.risk)
    console.log('portfolio health:', portfolio.health)
  })
})
