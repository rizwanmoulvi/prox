import { z } from 'zod'
import type { BackpackClient } from './client'

const PositionSchema = z.looseObject({
  symbol: z.string(),
  positionId: z.string(),
  /** Positive when long, negative when short. */
  netQuantity: z.string(),
  netExposureQuantity: z.string(),
  netExposureNotional: z.string(),
  entryPrice: z.string(),
  markPrice: z.string(),
  breakEvenPrice: z.string().nullish(),
  estLiquidationPrice: z.string().nullish(),
  imf: z.string(),
  mmf: z.string(),
  pnlRealized: z.string(),
  pnlUnrealized: z.string(),
  cumulativeFundingPayment: z.string(),
  cumulativeInterest: z.string().nullish(),
})
export type Position = z.infer<typeof PositionSchema>

const FundingPaymentSchema = z.looseObject({
  symbol: z.string(),
  quantity: z.string(),
  fundingRate: z.string(),
  intervalEndTimestamp: z.string(),
})
export type FundingPayment = z.infer<typeof FundingPaymentSchema>

export class PositionsApi {
  constructor(private readonly client: BackpackClient) {}

  /** Open futures positions. Backpack answers 404 when the filtered position does not exist. */
  async list(symbol?: string): Promise<Position[]> {
    try {
      return z.array(PositionSchema).parse(await this.client.signed('GET', '/api/v1/position', 'positionQuery', { symbol }))
    } catch (error) {
      if ((error as { status?: number }).status === 404) return []
      throw error
    }
  }

  async get(symbol: string): Promise<Position | null> {
    return (await this.list(symbol)).find((p) => p.symbol === symbol) ?? null
  }

  /** Funding payments for one market, newest first. */
  async fundingHistory(symbol: string, limit = 1000): Promise<FundingPayment[]> {
    const raw = await this.client.signed('GET', '/wapi/v1/history/funding', 'fundingHistoryQueryAll', { symbol, limit })
    return z.array(FundingPaymentSchema).parse(raw)
  }
}
