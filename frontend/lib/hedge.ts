// Small sums the screens share. Pure functions, so the landing page and the app agree.

export interface Outcome {
  /** What the stock position gains or loses. */
  stock: number
  /** What the short gains or loses. The opposite sign of the stock, scaled by the hedge. */
  hedge: number
  net: number
}

/** A price move of `movePct` percent against a stock position hedged by a short of `hedgeNotional`. */
export function outcome(stockValue: number, hedgeNotional: number, movePct: number): Outcome {
  const move = movePct / 100
  const stock = stockValue * move
  const hedge = -hedgeNotional * move
  return { stock, hedge, net: stock + hedge }
}

interface PerpPosition {
  symbol: string
  netQuantity: string
  markPrice: string
}

/** Size of a short already open on Backpack in this stock's perpetual, as a positive number. */
export function shortQuantityFor(stockSymbol: string, positions: PerpPosition[]): number {
  return positions
    .filter((p) => p.symbol.startsWith(`${stockSymbol}_`) && Number(p.netQuantity) < 0)
    .reduce((sum, p) => sum + Math.abs(Number(p.netQuantity)), 0)
}

/** "5h 12m", "2d 3h" or "under a minute" until `iso`, or null when it has passed. */
export function timeUntil(iso: string | null | undefined, nowMs: number): string | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - nowMs
  if (ms <= 0) return null
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'under a minute'
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}
