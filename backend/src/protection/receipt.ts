// PRD section 43: what the protection cost and what it saved, from Backpack's own history.

import Decimal from 'decimal.js'
import type { Backpack } from '../backpack'
import type { HedgeLeg, OrderRecord, Policy } from '../db/types'
import { protectionBps } from './protection.math'

export interface Receipt {
  asset: string
  protectionBps: number
  durationSec: number
  openedAt: string
  closedAt: string
  closeReason: string
  stockQuantity: string
  startingStockPrice: string
  endingStockPrice: string
  startingStockValue: string
  endingStockValue: string
  underlyingPnl: string
  hedgeQuantity: string
  entryPrice: string
  exitPrice: string
  hedgePnl: string
  funding: string
  fees: string
  /** USDC interest the whole account paid during the window; Backpack does not split it per position. */
  borrowInterest: string
  netProtectedValue: string
  trackingDifference: string
  orders: { purpose: string; side: string; quantity: string; avgPrice: string | null; fee: string; backpackOrderId: string | null }[]
}

export async function buildReceipt(backpack: Backpack, policy: Policy, leg: HedgeLeg, orders: OrderRecord[]): Promise<Receipt> {
  const openedAt = leg.openedAt ?? policy.startAt
  const closedAt = leg.closedAt ?? new Date()
  const [funding, interest] = await Promise.all([
    backpack.positions.fundingHistory(leg.perpSymbol),
    backpack.capital.interestHistory('USDC'),
  ])
  const inWindow = (timestamp: string) => {
    const t = Date.parse(timestamp.endsWith('Z') ? timestamp : `${timestamp}Z`)
    return t >= openedAt.getTime() && t <= closedAt.getTime()
  }
  // Funding accrues on the whole position; attribute our share of it.
  const totalShort = new Decimal(leg.openedQuantity).plus(leg.existingShortQuantity)
  const share = totalShort.gt(0) ? new Decimal(leg.openedQuantity).div(totalShort) : new Decimal(0)
  const fundingTotal = funding
    .filter((f) => inWindow(f.intervalEndTimestamp))
    .reduce((sum, f) => sum.plus(f.quantity), new Decimal(0))
    .mul(share)
  const interestPaid = interest
    .filter((i) => inWindow(i.timestamp) && new Decimal(i.quantity).lt(0))
    .reduce((sum, i) => sum.plus(i.quantity), new Decimal(0))

  const fees = orders.reduce((sum, o) => sum.plus(o.fee), new Decimal(0))
  const startingStockValue = new Decimal(leg.stockQuantity).mul(leg.stockMarkPrice)
  const endingStockPrice = new Decimal(leg.exitStockPrice ?? leg.currentStockPrice ?? leg.stockMarkPrice)
  const endingStockValue = new Decimal(leg.stockQuantity).mul(endingStockPrice)
  const underlyingPnl = endingStockValue.minus(startingStockValue)
  const hedgePnl = new Decimal(leg.realizedPnl)
  const netProtectedValue = endingStockValue.plus(hedgePnl).plus(fundingTotal).plus(interestPaid).minus(fees)

  // The level that was in force, from what was opened; the policy's own figure is 0 once closed.
  const levelBps = protectionBps(new Decimal(leg.openedQuantity).plus(leg.existingShortQuantity), leg.entryPrice ?? 0, startingStockValue)

  return {
    asset: leg.stockSymbol,
    protectionBps: levelBps,
    durationSec: Math.round((closedAt.getTime() - openedAt.getTime()) / 1000),
    openedAt: openedAt.toISOString(),
    closedAt: closedAt.toISOString(),
    closeReason: policy.closeReason ?? 'UNKNOWN',
    stockQuantity: leg.stockQuantity,
    startingStockPrice: leg.stockMarkPrice,
    endingStockPrice: endingStockPrice.toString(),
    startingStockValue: startingStockValue.toString(),
    endingStockValue: endingStockValue.toString(),
    underlyingPnl: underlyingPnl.toString(),
    hedgeQuantity: leg.openedQuantity,
    entryPrice: leg.entryPrice ?? '0',
    exitPrice: leg.exitPrice ?? '0',
    hedgePnl: hedgePnl.toString(),
    funding: fundingTotal.toString(),
    fees: fees.toString(),
    borrowInterest: interestPaid.toString(),
    netProtectedValue: netProtectedValue.toString(),
    trackingDifference: netProtectedValue.minus(startingStockValue).toString(),
    orders: orders.map((o) => ({
      purpose: o.purpose,
      side: o.side,
      quantity: o.executedQuantity,
      avgPrice: o.avgPrice,
      fee: o.fee,
      backpackOrderId: o.backpackOrderId,
    })),
  }
}
