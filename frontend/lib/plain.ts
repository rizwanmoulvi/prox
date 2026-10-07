// Plain-language labels and time helpers for the customer-facing screens.
// The product talks about cover and protection, never about perps, margin or oracles.

export const WHEN_OPTIONS = [
  { kind: 'OVERNIGHT', label: 'Overnight', hint: 'While US markets sleep, 8 PM to 4 AM ET' },
  { kind: 'POST_MARKET', label: 'After close', hint: 'The hours after the closing bell, 4 PM to 8 PM ET' },
  { kind: 'PRE_MARKET', label: 'Before open', hint: 'The hours before the opening bell, 4 AM to 9:30 AM ET' },
  { kind: 'WEEKEND', label: 'Weekend', hint: 'From Friday close to Monday open' },
  { kind: 'CUSTOM', label: 'Custom hours', hint: 'Any start and end you choose' },
] as const

export type WhenKind = (typeof WHEN_OPTIONS)[number]['kind']

export const DAY_OPTIONS = [
  { days: 1, label: 'Once' },
  { days: 5, label: 'This week' },
  { days: 14, label: 'Two weeks' },
  { days: 30, label: 'A month' },
] as const

/** "8:00 PM ET (5:30 AM your time)" */
export function etAndLocal(iso: string | null | undefined, withDay = false): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const et = d.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: withDay ? 'short' : undefined, hour: 'numeric', minute: '2-digit' })
  const local = d.toLocaleString(undefined, { weekday: withDay ? 'short' : undefined, hour: 'numeric', minute: '2-digit' })
  return sameZone() ? `${et} ET` : `${et} ET (${local} your time)`
}

export function localDay(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function sameZone(): boolean {
  return Intl.DateTimeFormat().resolvedOptions().timeZone === 'America/New_York'
}

/** What a protection is doing, in the customer's words. */
export function plainStatus(status: string): { text: string; tone: 'good' | 'neutral' | 'warn' | 'bad' } {
  switch (status) {
    case 'ACTIVE':
      return { text: 'Protected', tone: 'good' }
    case 'PARTIAL':
      return { text: 'Partly protected', tone: 'warn' }
    case 'WAIT_REOPEN':
      return { text: 'Protected, waiting for the market to open', tone: 'good' }
    case 'WAIT_CONVERGENCE':
      return { text: 'Market open, checking prices before lifting cover', tone: 'good' }
    case 'VALIDATING':
    case 'READY':
    case 'OPENING':
      return { text: 'Setting up cover', tone: 'neutral' }
    case 'REDUCING':
      return { text: 'Reducing cover to stay safe', tone: 'warn' }
    case 'EMERGENCY':
      return { text: 'Lifting cover to stay safe', tone: 'bad' }
    case 'EXPIRED':
    case 'CLOSING':
      return { text: 'Lifting cover', tone: 'neutral' }
    case 'CLOSED':
      return { text: 'Completed', tone: 'neutral' }
    case 'FAILED':
      return { text: 'Could not set up cover', tone: 'bad' }
    default:
      return { text: status, tone: 'neutral' }
  }
}

export function plainCloseReason(reason: string | null): string {
  switch (reason) {
    case 'CONVERGED':
      return 'lifted after the market reopened and prices settled'
    case 'WINDOW_END':
      return 'lifted at the end of the chosen hours'
    case 'MANUAL':
      return 'lifted by you'
    case 'EMERGENCY':
      return 'lifted early to keep the account safe'
    case 'EXPIRED':
      return 'lifted at the time limit'
    default:
      return 'lifted'
  }
}

export const TONE_CLASS: Record<'good' | 'neutral' | 'warn' | 'bad', string> = {
  good: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  neutral: 'bg-muted text-muted-foreground',
  warn: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  bad: 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200',
}

export function ticker(symbol: string): string {
  return symbol.replace(/\.US$/, '')
}
