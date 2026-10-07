import { describe, expect, it } from 'vitest'
import { nextStateStart, sessionAt, toEastern, type StockHoliday, type StockSession } from '../src/session'

// Session hours as Backpack documents them (Equity Futures specs) and returns them from
// GET /api/v1/stockSessions. Holiday rows are the Thanksgiving 2026 entries from
// GET /api/v1/stockHolidays, read on 2026-10-06.
const TZ = 'America/New_York'
const sessions: StockSession[] = [
  { name: 'US_EQUITIES_PRE_MARKET', startTime: '04:00:00', endTime: '09:30:00', startWeekday: 1, endWeekday: 5, timezone: TZ },
  { name: 'US_EQUITIES_REGULAR', startTime: '09:30:00', endTime: '16:00:00', startWeekday: 1, endWeekday: 5, timezone: TZ },
  { name: 'US_EQUITIES_POST_MARKET', startTime: '16:00:00', endTime: '20:00:00', startWeekday: 1, endWeekday: 5, timezone: TZ },
  { name: 'US_EQUITIES_OVERNIGHT', startTime: '20:00:00', endTime: '04:00:00', startWeekday: 7, endWeekday: 4, timezone: TZ },
]
const holidays: StockHoliday[] = [
  { date: '2026-11-25', startTime: '20:00:00', endTime: '23:59:59', name: 'Thanksgiving eve (overnight close)', timezone: TZ },
  { date: '2026-11-26', startTime: '00:00:00', endTime: '20:00:00', name: 'Thanksgiving Day', timezone: TZ },
  { date: '2026-11-27', startTime: '13:00:00', endTime: '23:59:59', name: 'Day after Thanksgiving (early close)', timezone: TZ },
]

const stateAt = (iso: string) => sessionAt(Date.parse(iso), sessions, holidays).state

describe('sessionAt', () => {
  it('follows the weekday session boundaries (Tuesday 2026-10-06, EDT)', () => {
    expect(stateAt('2026-10-06T13:29:59Z')).toBe('PREMARKET')
    expect(stateAt('2026-10-06T13:30:00Z')).toBe('REGULAR')
    expect(stateAt('2026-10-06T19:59:59Z')).toBe('REGULAR')
    expect(stateAt('2026-10-06T20:00:00Z')).toBe('POSTMARKET')
    expect(stateAt('2026-10-06T23:59:59Z')).toBe('POSTMARKET')
    expect(stateAt('2026-10-07T00:00:00Z')).toBe('OVERNIGHT')
    expect(stateAt('2026-10-07T07:59:59Z')).toBe('OVERNIGHT')
    expect(stateAt('2026-10-07T08:00:00Z')).toBe('PREMARKET')
  })

  it('is WEEKEND from Friday 20:00 ET to Sunday 20:00 ET', () => {
    expect(stateAt('2026-10-09T23:59:59Z')).toBe('POSTMARKET')
    expect(stateAt('2026-10-10T00:00:00Z')).toBe('WEEKEND')
    expect(stateAt('2026-10-10T16:00:00Z')).toBe('WEEKEND')
    expect(stateAt('2026-10-11T23:59:59Z')).toBe('WEEKEND')
    expect(stateAt('2026-10-12T00:00:00Z')).toBe('OVERNIGHT')
  })

  it('reports HOLIDAY inside a closure window and resumes after it (EST)', () => {
    expect(stateAt('2026-11-26T00:59:59Z')).toBe('POSTMARKET')
    expect(stateAt('2026-11-26T01:30:00Z')).toBe('HOLIDAY')
    expect(stateAt('2026-11-26T15:00:00Z')).toBe('HOLIDAY')
    expect(stateAt('2026-11-27T01:00:00Z')).toBe('OVERNIGHT')
    expect(stateAt('2026-11-27T17:59:59Z')).toBe('REGULAR')
    expect(stateAt('2026-11-27T18:00:00Z')).toBe('HOLIDAY')
  })

  it('opens at 09:30 local on both sides of the 2026 clock changes', () => {
    expect(stateAt('2026-03-06T14:29:59Z')).toBe('PREMARKET')
    expect(stateAt('2026-03-06T14:30:00Z')).toBe('REGULAR')
    expect(stateAt('2026-03-09T13:29:59Z')).toBe('PREMARKET')
    expect(stateAt('2026-03-09T13:30:00Z')).toBe('REGULAR')
    expect(stateAt('2026-11-02T13:30:00Z')).toBe('PREMARKET')
    expect(stateAt('2026-11-02T14:30:00Z')).toBe('REGULAR')
  })

  it('names the session or holiday it found', () => {
    expect(sessionAt(Date.parse('2026-10-06T14:00:00Z'), sessions, holidays).sessionName).toBe('US_EQUITIES_REGULAR')
    expect(sessionAt(Date.parse('2026-11-26T15:00:00Z'), sessions, holidays).holidayName).toBe('Thanksgiving Day')
  })
})

describe('toEastern', () => {
  it('matches the platform time zone database across 2026 and 2027', () => {
    const format = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const step = 37 * 60_000
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2028, 0, 1); t += step) {
      const parts = Object.fromEntries(format.formatToParts(t).map((p) => [p.type, p.value]))
      const eastern = toEastern(t)
      const expectedSeconds = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second)
      expect(eastern.date, new Date(t).toISOString()).toBe(`${parts.year}-${parts.month}-${parts.day}`)
      expect(eastern.secondOfDay, new Date(t).toISOString()).toBe(expectedSeconds)
    }
  })
})

describe('nextStateStart', () => {
  const next = (iso: string, target: 'REGULAR' | 'WEEKEND') => {
    const at = nextStateStart(Date.parse(iso), target, sessions, holidays)
    return at === null ? null : new Date(at).toISOString()
  }

  it('finds the next regular open on the following trading day', () => {
    expect(next('2026-10-06T14:00:00Z', 'REGULAR')).toBe('2026-10-07T13:30:00.000Z')
  })

  it('carries a Friday position over the weekend to Monday 09:30 ET', () => {
    expect(next('2026-10-09T19:00:00Z', 'WEEKEND')).toBe('2026-10-10T00:00:00.000Z')
    expect(next('2026-10-09T19:00:00Z', 'REGULAR')).toBe('2026-10-12T13:30:00.000Z')
  })

  it('skips a full-day holiday', () => {
    expect(next('2026-11-25T20:00:00Z', 'REGULAR')).toBe('2026-11-27T14:30:00.000Z')
  })
})
