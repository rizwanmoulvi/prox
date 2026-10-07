// Scheduled protection windows: the concrete start and end instants of a recurring window
// over a span of calendar days, built from Backpack's session calendar.

import { sessionAt, toEastern, type EasternTime, type SessionState, type StockHoliday, type StockSession } from './session'

export type WindowKind = 'PRE_MARKET' | 'POST_MARKET' | 'OVERNIGHT' | 'CUSTOM'

export interface WindowSpec {
  kind: WindowKind
  /** ET clock times, HH:MM, for CUSTOM only. An end at or before the start means the next day. */
  customStart?: string
  customEnd?: string
}

export interface PlannedWindow {
  /** ET calendar date the window belongs to (its start date). */
  date: string
  startMs: number
  endMs: number
  /** How the hedge closes: at the end instant, or through the oracle after the 09:30 open. */
  closeRule: 'AT_END' | 'CONVERGENCE'
  /** Why a day was skipped, when it was. */
  skipped?: string
}

const SESSION_FOR_KIND: Record<Exclude<WindowKind, 'CUSTOM'>, SessionState> = {
  PRE_MARKET: 'PREMARKET',
  POST_MARKET: 'POSTMARKET',
  OVERNIGHT: 'OVERNIGHT',
}

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
const SCAN_STEP_MS = 60_000

/**
 * One entry per calendar day from `startDate` for `days` days. Days without the session are
 * returned with `skipped` set so the user sees exactly what will run. A window already in
 * progress on the first day starts now rather than in the past.
 */
export function planWindows(
  spec: WindowSpec,
  startDate: string,
  days: number,
  nowMs: number,
  sessions: StockSession[],
  holidays: StockHoliday[],
): PlannedWindow[] {
  const out: PlannedWindow[] = []
  for (let i = 0; i < days; i++) {
    const date = addDays(startDate, i)
    const window = spec.kind === 'CUSTOM' ? customWindow(spec, date) : sessionWindow(spec.kind, date, sessions, holidays)
    if (!window) {
      out.push({ date, startMs: 0, endMs: 0, closeRule: 'AT_END', skipped: `no ${label(spec.kind)} session on ${date}` })
      continue
    }
    if (window.endMs <= nowMs) {
      out.push({ ...window, skipped: 'already over' })
      continue
    }
    out.push({ ...window, startMs: Math.max(window.startMs, nowMs) })
  }
  return out
}

/** UTC instant of an ET wall-clock time, DST aware. */
export function fromEastern(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm, ss = 0] = time.split(':').map(Number)
  const wall = Date.UTC(y!, m! - 1, d!, hh!, mm!, ss)
  // Start from the standard-time guess, then correct with the offset in force at that instant.
  const guess = wall + 5 * HOUR_MS
  return wall - offsetAt(guess) * HOUR_MS
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y!, m! - 1, d! + days))
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`
}

/** The ET calendar date of an instant. */
export function easternDate(utcMs: number): string {
  return toEastern(utcMs).date
}

export function label(kind: WindowKind): string {
  return { PRE_MARKET: 'pre-market', POST_MARKET: 'after-hours', OVERNIGHT: 'overnight', CUSTOM: 'custom' }[kind]
}

function sessionWindow(kind: Exclude<WindowKind, 'CUSTOM'>, date: string, sessions: StockSession[], holidays: StockHoliday[]): PlannedWindow | null {
  const state = SESSION_FOR_KIND[kind]
  const session = sessions.find((s) => sessionStateName(s.name) === state)
  if (!session) return null
  const startMs = fromEastern(date, session.startTime)
  // The calendar decides whether the session really runs that day (weekday, holiday, early close).
  if (sessionAt(startMs, sessions, holidays).state !== state) return null
  const endMs = nextChange(startMs, sessions, holidays, 2 * DAY_MS)
  if (endMs === null) return null
  const endsAtOpen = sessionAt(endMs, sessions, holidays).state === 'REGULAR'
  return { date, startMs, endMs, closeRule: endsAtOpen ? 'CONVERGENCE' : 'AT_END' }
}

function customWindow(spec: WindowSpec, date: string): PlannedWindow | null {
  if (!spec.customStart || !spec.customEnd) return null
  const startMs = fromEastern(date, spec.customStart)
  let endMs = fromEastern(date, spec.customEnd)
  if (endMs <= startMs) endMs = fromEastern(addDays(date, 1), spec.customEnd)
  return { date, startMs, endMs, closeRule: 'AT_END' }
}

/** First instant after `fromMs` where the session state changes. */
function nextChange(fromMs: number, sessions: StockSession[], holidays: StockHoliday[], horizonMs: number): number | null {
  const start = Math.floor(fromMs / 1000) * 1000
  const initial = sessionAt(start, sessions, holidays).state
  const changed = (t: number) => sessionAt(t, sessions, holidays).state !== initial
  let lo = start
  for (let t = start + SCAN_STEP_MS; t <= start + horizonMs; t += SCAN_STEP_MS) {
    if (changed(t)) {
      let hi = t
      while (hi - lo > 1000) {
        const mid = lo + Math.floor((hi - lo) / 2000) * 1000
        if (changed(mid)) hi = mid
        else lo = mid
      }
      return hi
    }
    lo = t
  }
  return null
}

function sessionStateName(name: string): SessionState | null {
  if (name.endsWith('PRE_MARKET')) return 'PREMARKET'
  if (name.endsWith('POST_MARKET')) return 'POSTMARKET'
  if (name.endsWith('REGULAR')) return 'REGULAR'
  if (name.endsWith('OVERNIGHT')) return 'OVERNIGHT'
  return null
}

function offsetAt(utcMs: number): number {
  // Re-derive the offset the way session.ts does: compare the ET wall clock with UTC.
  const et: EasternTime = toEastern(utcMs)
  const utc = new Date(utcMs)
  const wallMs = Date.UTC(et.year, et.month - 1, et.day) + et.secondOfDay * 1000
  const utcWallMs = Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), utc.getUTCHours(), utc.getUTCMinutes(), utc.getUTCSeconds())
  return Math.round((wallMs - utcWallMs) / HOUR_MS)
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}
