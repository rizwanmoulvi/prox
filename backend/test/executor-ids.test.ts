import { describe, expect, it } from 'vitest'
import { clientIdFor } from '../src/execution/hedge.executor'
import { buyLimitPrice, sellLimitPrice } from '../src/protection/protection.preview'

// PRD section 19: every logical action gets a deterministic numeric clientId.
describe('clientIdFor', () => {
  it('is the same number every time for the same logical id', () => {
    expect(clientIdFor('POLICY123_NVDA_OPEN_1')).toBe(clientIdFor('POLICY123_NVDA_OPEN_1'))
  })

  it('differs between actions and fits a uint32', () => {
    const open = clientIdFor('POLICY123_NVDA_OPEN_1')
    const close = clientIdFor('POLICY123_NVDA_CLOSE_1')
    expect(open).not.toBe(close)
    for (const id of [open, close]) {
      expect(Number.isInteger(id)).toBe(true)
      expect(id).toBeGreaterThan(0)
      expect(id).toBeLessThanOrEqual(0xffffffff)
    }
  })
})

describe('bounded limit prices', () => {
  it('sells no lower than the slippage bound below the bid, on the tick grid', () => {
    expect(sellLimitPrice('239.67', '0.01', 30)).toBe('238.95')
  })

  it('buys no higher than the slippage bound above the ask, on the tick grid', () => {
    expect(buyLimitPrice('239.68', '0.01', 30)).toBe('240.4')
  })
})
