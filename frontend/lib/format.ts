// Display helpers. Values arrive as decimal strings and stay strings until the last moment.

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const usdFine = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 })

export function money(value: string | number | null | undefined, fine = false): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  // A hedge that offsets the stock leaves a remainder like -0.0001; show that as $0.00, not -$0.00.
  const shown = (fine ? usdFine : usd).format(n)
  return /^-\$0\.0+$/.test(shown) ? shown.slice(1) : shown
}

/** Signed money for PnL: +$1.20 / -$0.35 */
export function signedMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  // Four decimals only when two would round a real amount down to nothing.
  const text = money(Math.abs(n), Math.abs(n) > 0 && Math.abs(n) < 0.01)
  return n > 0 ? `+${text}` : n < 0 ? `-${text}` : text
}

export function percent(fraction: string | number | null | undefined, digits = 1): string {
  if (fraction === null || fraction === undefined) return '—'
  const n = Number(fraction)
  if (!Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(digits)}%`
}

export function bpsPercent(bps: number): string {
  return `${Math.round(bps / 100)}%`
}

export function basis(bps: string | number | null | undefined): string {
  if (bps === null || bps === undefined) return '—'
  return `${Number(bps).toFixed(2)} bps`
}

export function quantity(value: string | null | undefined, symbol?: string): string {
  if (!value) return '—'
  return symbol ? `${value} ${symbol}` : value
}

export function when(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** A date without the year, for places where the year is obvious: "Oct 7, 7:00 PM". */
export function whenShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}

export const STATUS_LABEL: Record<string, string> = {
  VALIDATING: 'Validating',
  READY: 'Ready',
  OPENING: 'Opening hedge',
  ACTIVE: 'Active',
  PARTIAL: 'Partially protected',
  WAIT_REOPEN: 'Waiting for market open',
  WAIT_CONVERGENCE: 'Waiting for convergence',
  REDUCING: 'Reducing hedge',
  EMERGENCY: 'Emergency close',
  EXPIRED: 'Window expired',
  CLOSING: 'Closing hedge',
  CLOSED: 'Completed',
  FAILED: 'Failed',
}

export const SESSION_LABEL: Record<string, string> = {
  PREMARKET: 'Pre-market',
  REGULAR: 'Market open',
  POSTMARKET: 'After hours',
  OVERNIGHT: 'Overnight',
  WEEKEND: 'Weekend',
  HOLIDAY: 'Holiday',
}

const NEW_YORK = 'America/New_York'

/** A clock time in New York, where the US market sessions are defined: "8:00 PM". */
export function nyTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { timeZone: NEW_YORK, hour: 'numeric', minute: '2-digit' })
}

/** The same instant on the viewer's own clock, or null when the viewer is in New York time. */
export function localTime(iso: string | null | undefined): string | null {
  if (!iso || Intl.DateTimeFormat().resolvedOptions().timeZone === NEW_YORK) return null
  return new Date(iso).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** "Thu, Oct 8" on the viewer's calendar. */
export function dayLabel(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export const WINDOW_LABEL: Record<string, string> = {
  OVERNIGHT: 'Overnight',
  POST_MARKET: 'After hours',
  PRE_MARKET: 'Pre-market',
  CUSTOM: 'Custom hours',
}

export const RUN_LABEL: Record<string, string> = {
  SCHEDULED: 'Scheduled',
  SKIPPED: 'Skipped',
  OPENING: 'Opening',
  OPEN: 'Protecting',
  DONE: 'Done',
  FAILED: 'Failed',
}
