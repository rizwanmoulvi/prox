import { z } from 'zod'
import type { BackpackClient } from './client'

export type Side = 'Bid' | 'Ask'

const OrderSchema = z.looseObject({
  id: z.string(),
  clientId: z.number().nullish(),
  symbol: z.string(),
  side: z.enum(['Bid', 'Ask']),
  orderType: z.string(),
  status: z.string(),
  quantity: z.string().nullish(),
  price: z.string().nullish(),
  executedQuantity: z.string().nullish(),
  executedQuoteQuantity: z.string().nullish(),
  reduceOnly: z.boolean().nullish(),
  timeInForce: z.string().nullish(),
  createdAt: z.number().nullish(),
})
export type Order = z.infer<typeof OrderSchema>

const FillSchema = z.looseObject({
  orderId: z.string(),
  tradeId: z.number().nullish(),
  symbol: z.string(),
  side: z.enum(['Bid', 'Ask']),
  price: z.string(),
  quantity: z.string(),
  fee: z.string(),
  feeSymbol: z.string(),
  isMaker: z.boolean(),
  timestamp: z.string(),
})
export type Fill = z.infer<typeof FillSchema>

const MaxOrderQuantitySchema = z.looseObject({ maxOrderQuantity: z.string(), symbol: z.string() })

export interface OrderRequest {
  symbol: string
  side: Side
  quantity: string
  reduceOnly: boolean
  clientId: number
  /** Present for a limit order, absent for a market order. */
  price?: string
  timeInForce?: 'IOC'
}

export class OrdersApi {
  constructor(private readonly client: BackpackClient) {}

  /** Sends one order. A timeout here means the outcome is unknown: reconcile, do not resend. */
  async execute(request: OrderRequest): Promise<Order> {
    const body = { ...request, orderType: request.price ? 'Limit' : 'Market' }
    return OrderSchema.parse(await this.client.signed('POST', '/api/v1/order', 'orderExecute', body))
  }

  /** An order still on the book, looked up by our client id. Null when it is not open. */
  async findOpen(symbol: string, clientId: number): Promise<Order | null> {
    try {
      return OrderSchema.parse(await this.client.signed('GET', '/api/v1/order', 'orderQuery', { symbol, clientId }))
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null
      throw error
    }
  }

  async open(symbol?: string): Promise<Order[]> {
    return z.array(OrderSchema).parse(await this.client.signed('GET', '/api/v1/orders', 'orderQueryAll', { symbol }))
  }

  async cancel(symbol: string, orderId: string): Promise<void> {
    await this.client.signed('DELETE', '/api/v1/order', 'orderCancel', { symbol, orderId })
  }

  /** Orders that have left the book, newest first. */
  async history(symbol: string, limit = 100): Promise<Order[]> {
    const raw = await this.client.signed('GET', '/wapi/v1/history/orders', 'orderHistoryQueryAll', { symbol, limit })
    return z.array(OrderSchema).parse(raw)
  }

  async fills(orderId: string): Promise<Fill[]> {
    const raw = await this.client.signed('GET', '/wapi/v1/history/fills', 'fillHistoryQueryAll', { orderId })
    return z.array(FillSchema).parse(raw)
  }

  /** The largest quantity Backpack will accept right now for this account, symbol and side. */
  async maxQuantity(symbol: string, side: Side, price?: string, reduceOnly = false): Promise<string> {
    const params = { symbol, side, price, reduceOnly }
    const raw = await this.client.signed('GET', '/api/v1/account/limits/order', 'maxOrderQuantity', params)
    return MaxOrderQuantitySchema.parse(raw).maxOrderQuantity
  }
}
