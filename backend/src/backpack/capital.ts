import { z } from 'zod'
import type { BackpackClient } from './client'

const BalanceSchema = z.looseObject({ available: z.string(), locked: z.string(), staked: z.string() })
const BalancesSchema = z.record(z.string(), BalanceSchema)
export type Balances = z.infer<typeof BalancesSchema>

const InterestPaymentSchema = z.looseObject({
  quantity: z.string(),
  symbol: z.string(),
  timestamp: z.string(),
  paymentType: z.string().nullish(),
  marketSymbol: z.string().nullish(),
})
export type InterestPayment = z.infer<typeof InterestPaymentSchema>

export class CapitalApi {
  constructor(private readonly client: BackpackClient) {}

  /** Balances by asset symbol. */
  async balances(): Promise<Balances> {
    return BalancesSchema.parse(await this.client.signed('GET', '/api/v1/capital', 'balanceQuery'))
  }

  /** Interest paid or earned, newest first. `asset` narrows it to one asset such as USDC. */
  async interestHistory(asset?: string, limit = 1000): Promise<InterestPayment[]> {
    const raw = await this.client.signed('GET', '/wapi/v1/history/interest', 'interestHistoryQueryAll', { asset, limit })
    return z.array(InterestPaymentSchema).parse(raw)
  }
}
