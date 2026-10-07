// US equity session state, computed from the session and holiday lists Backpack publishes
// (GET /api/v1/stockSessions, GET /api/v1/stockHolidays). Runs in Node and in the CRE
// workflow's WASM runtime, so it does its own US Eastern clock math instead of using Intl.

export type SessionState = 'PREMARKET' | 'REGULAR' | 'POSTMARKET' | 'OVERNIGHT' | 'WEEKEND' | 'HOLIDAY'

export const SESSION_STATES: readonly SessionState[] = [
  'PREMARKET',
  'REGULAR',
  'POSTMARKET',
  'OVERNIGHT',
  'WEEKEND',
  'HOLIDAY',
]

export interface StockSession {
  name: string
  startTime: string
  endTime: string
  /** 1 = Monday ... 7 = Sunday. The days a session starts on. */
  startWeekday: number
  endWeekday: number
  timezone: string
}

export interface StockHoliday {
  date: string
  startTime: string
  endTime: string
  name: string
  timezone: string
}

export interface SessionInfo {
  state: SessionState
  sessionName: string | null
  holidayName: string | null
}

export interface EasternTime {
  year: number
  month: number
  day: number
  /** 1 = Monday ... 7 = Sunday */
  weekday: number
  secondOfDay: number
  date: string
}

const SUPPORTED_TIMEZONE = 'America/New_York'
const HOUR_MS = 3_600_000
const SCAN_STEP_MS = 5 * 60_000

/** Session state at a UTC instant. */
export function sessionAt(utcMs: number, sessions: StockSession[], holidays: StockHoliday[]): SessionInfo {
  const now = toEastern(utcMs)
  const holiday = holidays.find((h) => holidayCovers(h, now))
  if (holiday) return { state: 'HOLIDAY', sessionName: null, holidayName: holiday.name }

  const session = sessions.find((s) => sessionCovers(s, now))
  if (session) return { state: stateForSessionName(session.name), sessionName: session.name, holidayName: null }

  const weekendGap = now.weekday >= 5
  return { state: weekendGap ? 'WEEKEND' : 'HOLIDAY', sessionName: null, holidayName: null }
}

/**
 * First instant after `fromMs` at which the market enters `target`, to the second.
 * Returns null when it does not happen within `horizonMs`.
 */
export function nextStateStart(
  fromMs: number,
  target: SessionState,
  sessions: StockSession[],
  holidays: StockHoliday[],
  horizonMs = 14 * 24 * HOUR_MS,
): number | null {
  const isTarget = (t: number) => sessionAt(t, sessions, holidays).state === target
  // Scan on whole seconds so the bisected boundary lands exactly on the session edge.
  const start = Math.floor(fromMs / 1000) * 1000
  let previous = start
  let wasTarget = isTarget(previous)
  for (let t = start + SCAN_STEP_MS; t <= start + horizonMs; t += SCAN_STEP_MS) {
    const nowTarget = isTarget(t)
    if (nowTarget && !wasTarget) return bisectBoundary(previous, t, isTarget)
    previous = t
    wasTarget = nowTarget
  }
  return null
}

/** Wall clock in US Eastern time for a UTC instant. */
export function toEastern(utcMs: number): EasternTime {
  const local = new Date(utcMs + easternOffsetHours(utcMs) * HOUR_MS)
  const year = local.getUTCFullYear()
  const month = local.getUTCMonth() + 1
  const day = local.getUTCDate()
  const weekday = local.getUTCDay() === 0 ? 7 : local.getUTCDay()
  const secondOfDay = local.getUTCHours() * 3600 + local.getUTCMinutes() * 60 + local.getUTCSeconds()
  return { year, month, day, weekday, secondOfDay, date: `${year}-${pad2(month)}-${pad2(day)}` }
}

/** Backpack session names end in the session kind, for example US_EQUITIES_PRE_MARKET. */
export function stateForSessionName(name: string): SessionState {
  if (name.endsWith('PRE_MARKET')) return 'PREMARKET'
  if (name.endsWith('POST_MARKET')) return 'POSTMARKET'
  if (name.endsWith('REGULAR')) return 'REGULAR'
  if (name.endsWith('OVERNIGHT')) return 'OVERNIGHT'
  throw new Error(`Unknown stock session name: ${name}`)
}

function sessionCovers(session: StockSession, now: EasternTime): boolean {
  assertEastern(session.timezone)
  const start = secondsOf(session.startTime)
  const end = secondsOf(session.endTime)
  const startsToday = inWeekdayRange(now.weekday, session.startWeekday, session.endWeekday)
  if (end > start) return startsToday && now.secondOfDay >= start && now.secondOfDay < end

  // Crosses midnight: it starts on a listed weekday and ends the next morning.
  if (now.secondOfDay >= start) return startsToday
  const yesterday = now.weekday === 1 ? 7 : now.weekday - 1
  return now.secondOfDay < end && inWeekdayRange(yesterday, session.startWeekday, session.endWeekday)
}

function holidayCovers(holiday: StockHoliday, now: EasternTime): boolean {
  assertEastern(holiday.timezone)
  if (holiday.date !== now.date) return false
  const start = secondsOf(holiday.startTime)
  // Backpack writes "until end of day" as 23:59:59; other end times are exclusive.
  const end = holiday.endTime === '23:59:59' ? 86_400 : secondsOf(holiday.endTime)
  return now.secondOfDay >= start && now.secondOfDay < end
}

function inWeekdayRange(weekday: number, first: number, last: number): boolean {
  return first <= last ? weekday >= first && weekday <= last : weekday >= first || weekday <= last
}

function bisectBoundary(lo: number, hi: number, isTarget: (t: number) => boolean): number {
  while (hi - lo > 1000) {
    const mid = lo + Math.floor((hi - lo) / 2000) * 1000
    if (isTarget(mid)) hi = mid
    else lo = mid
  }
  return hi
}

// US daylight time runs from 02:00 on the second Sunday of March to 02:00 on the first Sunday of November.
function easternOffsetHours(utcMs: number): number {
  const year = new Date(utcMs).getUTCFullYear()
  const dstStart = Date.UTC(year, 2, nthSunday(year, 2, 2), 7)
  const dstEnd = Date.UTC(year, 10, nthSunday(year, 10, 1), 6)
  return utcMs >= dstStart && utcMs < dstEnd ? -4 : -5
}

function nthSunday(year: number, monthIndex: number, n: number): number {
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay()
  return 1 + ((7 - firstWeekday) % 7) + (n - 1) * 7
}

function secondsOf(hms: string): number {
  const [h, m, s] = hms.split(':').map(Number)
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) throw new Error(`Bad time: ${hms}`)
  return h * 3600 + m * 60 + (s ?? 0)
}

function assertEastern(timezone: string): void {
  if (timezone !== SUPPORTED_TIMEZONE) throw new Error(`Unsupported session timezone: ${timezone}`)
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}
