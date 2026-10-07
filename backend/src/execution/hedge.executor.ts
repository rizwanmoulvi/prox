// Sends the two order shapes this app is allowed to send and records what happened to each.
// Opening sells (Ask, never reduce-only). Closing buys back (Bid, always reduce-only).

import { createHash } from 'node:crypto'
import Decimal from 'decimal.js'
import type { Backpack, Market, Order } from '../backpack'
import { BackpackApiError, BackpackTimeoutError } from '../backpack'
import type { Config } from '../config'
import type { OrderRepo } from '../db/orders'
import type { OrderPurpose, OrderRecord, OrderRecordStatus } from '../db/types'
import type { LivePrices } from '../market/live-prices'
import { buyLimitPrice, sellLimitPrice } from '../protection/protection.preview'

export interface ExecutionResult {
  record: OrderRecord
  outcome: OrderRecordStatus
  filledQuantity: Decimal
  avgPrice: Decimal | null
  fee: Decimal
}

// An order we never heard back about and cannot find after this long did not reach the engine.
const UNKNOWN_GRACE_MS = 90_000

export class HedgeExecutor {
  constructor(
    private readonly config: Config,
    private readonly backpack: Backpack,
    private readonly orders: OrderRepo,
    private readonly prices: LivePrices,
  ) {}

  async openShort(policyId: string, perp: Market, quantity: Decimal, attempt: number): Promise<ExecutionResult> {
    const quote = await this.prices.perp(perp.symbol)
    const price = sellLimitPrice(quote.bestBid ?? quote.markPrice, perp.filters.price.tickSize, this.config.MAX_SLIPPAGE_BPS)
    const logicalId = `${policyId}_${perp.symbol}_OPEN_${attempt}`
    return this.send({ policyId, logicalId, purpose: 'OPEN', perp, side: 'Ask', reduceOnly: false, quantity, price })
  }

  async closeShort(policyId: string, perp: Market, quantity: Decimal, attempt: number, purpose: 'CLOSE' | 'REDUCE'): Promise<ExecutionResult> {
    const quote = await this.prices.perp(perp.symbol)
    const price = buyLimitPrice(quote.bestAsk ?? quote.markPrice, perp.filters.price.tickSize, this.config.MAX_SLIPPAGE_BPS)
    const logicalId = `${policyId}_${perp.symbol}_${purpose}_${attempt}`
    return this.send({ policyId, logicalId, purpose, perp, side: 'Bid', reduceOnly: true, quantity, price })
  }

  /** Finds out what became of an order whose outcome is still open (PRD section 19). */
  async reconcile(record: OrderRecord): Promise<ExecutionResult> {
    const open = await this.backpack.orders.findOpen(record.symbol, record.clientId)
    if (open) {
      // IOC orders never rest, so anything still open is a surprise: take it off the book first.
      await this.backpack.orders.cancel(record.symbol, open.id)
    }
    const history = await this.backpack.orders.history(record.symbol, 100)
    const order = history.find((o) => o.clientId === record.clientId) ?? open
    if (order) return this.settle(record, order)
    if (Date.now() - record.createdAt.getTime() > UNKNOWN_GRACE_MS) {
      return this.finish(record, 'UNFILLED', new Decimal(0), null, new Decimal(0), null, 'Not found at Backpack after the grace period')
    }
    return { record, outcome: 'UNKNOWN', filledQuantity: new Decimal(0), avgPrice: null, fee: new Decimal(0) }
  }

  private async send(input: {
    policyId: string
    logicalId: string
    purpose: OrderPurpose
    perp: Market
    side: 'Bid' | 'Ask'
    reduceOnly: boolean
    quantity: Decimal
    price: string
  }): Promise<ExecutionResult> {
    const existing = await this.orders.byLogicalId(input.logicalId)
    if (existing) return existing.status === 'PENDING' || existing.status === 'UNKNOWN' ? this.reconcile(existing) : fromRecord(existing)

    const record = await this.orders.create({
      policyId: input.policyId,
      logicalId: input.logicalId,
      clientId: clientIdFor(input.logicalId),
      purpose: input.purpose,
      symbol: input.perp.symbol,
      side: input.side,
      reduceOnly: input.reduceOnly,
      quantity: input.quantity.toString(),
      price: input.price,
    })

    let order: Order
    try {
      order = await this.backpack.orders.execute({
        symbol: input.perp.symbol,
        side: input.side,
        quantity: input.quantity.toString(),
        price: input.price,
        timeInForce: 'IOC',
        reduceOnly: input.reduceOnly,
        clientId: record.clientId,
      })
    } catch (error) {
      if (error instanceof BackpackTimeoutError) {
        await this.orders.update(record.logicalId, { status: 'UNKNOWN', error: error.message })
        return this.reconcile({ ...record, status: 'UNKNOWN' })
      }
      const message = error instanceof BackpackApiError ? `${error.code ?? error.status}: ${error.message}` : String(error)
      return this.finish(record, 'REJECTED', new Decimal(0), null, new Decimal(0), null, message)
    }
    return this.settle(record, order)
  }

  private async settle(record: OrderRecord, order: Order): Promise<ExecutionResult> {
    const executed = new Decimal(order.executedQuantity ?? 0)
    const fills = executed.gt(0) ? await this.fillsFor(order.id) : []
    const fee = fills.reduce((sum, f) => sum.plus(f.fee), new Decimal(0))
    const avgPrice = fills.length
      ? fills.reduce((sum, f) => sum.plus(new Decimal(f.price).mul(f.quantity)), new Decimal(0)).div(executed)
      : executed.gt(0) && order.executedQuoteQuantity
        ? new Decimal(order.executedQuoteQuantity).div(executed)
        : null
    const outcome: OrderRecordStatus = executed.gte(record.quantity) ? 'FILLED' : executed.gt(0) ? 'PARTIAL' : 'UNFILLED'
    return this.finish(record, outcome, executed, avgPrice, fee, order.id, null, fills[0]?.feeSymbol ?? null)
  }

  /** Fill history can trail the order response by a moment. */
  private async fillsFor(orderId: string) {
    for (let i = 0; i < 4; i++) {
      const fills = await this.backpack.orders.fills(orderId)
      if (fills.length) return fills
      await new Promise((r) => setTimeout(r, 500))
    }
    return []
  }

  private async finish(
    record: OrderRecord,
    outcome: OrderRecordStatus,
    filledQuantity: Decimal,
    avgPrice: Decimal | null,
    fee: Decimal,
    backpackOrderId: string | null,
    error: string | null,
    feeSymbol: string | null = null,
  ): Promise<ExecutionResult> {
    const updated = await this.orders.update(record.logicalId, {
      status: outcome,
      executedQuantity: filledQuantity.toString(),
      avgPrice: avgPrice?.toString() ?? null,
      fee: fee.toString(),
      feeSymbol,
      backpackOrderId,
      error,
    })
    return { record: updated, outcome, filledQuantity, avgPrice, fee }
  }
}

function fromRecord(record: OrderRecord): ExecutionResult {
  return {
    record,
    outcome: record.status,
    filledQuantity: new Decimal(record.executedQuantity),
    avgPrice: record.avgPrice === null ? null : new Decimal(record.avgPrice),
    fee: new Decimal(record.fee),
  }
}

/** Backpack wants a uint32 client id; the first four bytes of the logical id's hash are stable and unique enough. */
export function clientIdFor(logicalId: string): number {
  const id = createHash('sha256').update(logicalId).digest().readUInt32BE(0)
  return id === 0 ? 1 : id
}
