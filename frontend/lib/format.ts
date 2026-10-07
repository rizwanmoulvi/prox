// Display helpers. Values arrive as decimal strings and stay strings until the last moment.

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const usdFine = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 })

export function money(value: string | number | null | undefined, fine = false): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return (fine ? usdFine : usd).format(n)
}

/** Signed money for PnL: +$1.20 / -$0.35 */
export function signedMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const text = money(Math.abs(n), Math.abs(n) < 1)
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

export const WINDOW_LABEL: Record<string, string> = {
  PRE_MARKET: 'Pre-market',
  POST_MARKET: 'After hours',
  OVERNIGHT: 'Overnight',
  CUSTOM: 'Custom',
}

export const PLAN_RUN_LABEL: Record<string, string> = {
  SCHEDULED: 'Scheduled',
  SKIPPED: 'Skipped',
  OPENING: 'Opening',
  OPEN: 'Protecting',
  DONE: 'Done',
  FAILED: 'Failed',
}

/** A time in US Eastern, the clock Backpack's sessions use. */
export function easternTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'
}
