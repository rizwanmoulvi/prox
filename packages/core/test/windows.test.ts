import { describe, expect, it } from 'vitest'
import type { StockHoliday, StockSession } from '../src/session'
import { addDays, dateInZone, fromEastern, fromZone, isTimeZone, planWindows } from '../src/windows'

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
const iso = (ms: number) => new Date(ms).toISOString()

describe('fromEastern', () => {
  it('converts ET wall-clock times on both sides of the clock change', () => {
    expect(iso(fromEastern('2026-10-06', '20:00:00'))).toBe('2026-10-07T00:00:00.000Z')
    expect(iso(fromEastern('2026-11-02', '04:00:00'))).toBe('2026-11-02T09:00:00.000Z')
    expect(iso(fromEastern('2026-03-09', '09:30'))).toBe('2026-03-09T13:30:00.000Z')
  })
  it('adds days across month ends', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
  })
})

describe('planWindows', () => {
  const monday = Date.parse('2026-10-05T12:00:00Z')

  it('plans overnight for seven calendar days and skips Friday and Saturday nights', () => {
    const runs = planWindows({ kind: 'OVERNIGHT' }, '2026-10-05', 7, monday, sessions, holidays)
    expect(runs.map((r) => r.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'])
    expect(runs.filter((r) => !r.skipped).map((r) => r.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-11'])
    expect(iso(runs[0]!.startMs)).toBe('2026-10-06T00:00:00.000Z')
    expect(iso(runs[0]!.endMs)).toBe('2026-10-06T08:00:00.000Z')
    expect(runs[0]!.closeRule).toBe('AT_END')
    expect(runs[5]!.skipped).toMatch(/no overnight session/)
  })

  it('hands a pre-market window to the oracle because it ends at the open', () => {
    const runs = planWindows({ kind: 'PRE_MARKET' }, '2026-10-06', 1, monday, sessions, holidays)
    expect(iso(runs[0]!.startMs)).toBe('2026-10-06T08:00:00.000Z')
    expect(iso(runs[0]!.endMs)).toBe('2026-10-06T13:30:00.000Z')
    expect(runs[0]!.closeRule).toBe('CONVERGENCE')
  })

  it('closes an after-hours window at 20:00 ET', () => {
    const runs = planWindows({ kind: 'POST_MARKET' }, '2026-10-06', 1, monday, sessions, holidays)
    expect(iso(runs[0]!.startMs)).toBe('2026-10-06T20:00:00.000Z')
    expect(iso(runs[0]!.endMs)).toBe('2026-10-07T00:00:00.000Z')
    expect(runs[0]!.closeRule).toBe('AT_END')
  })

  it('starts a window that is already running right now, and marks one that is over', () => {
    const during = Date.parse('2026-10-06T02:00:00Z')
    const runs = planWindows({ kind: 'OVERNIGHT' }, '2026-10-05', 2, during, sessions, holidays)
    expect(iso(runs[0]!.startMs)).toBe('2026-10-06T02:00:00.000Z')
    expect(runs[0]!.skipped).toBeUndefined()
    const later = Date.parse('2026-10-06T09:00:00Z')
    expect(planWindows({ kind: 'OVERNIGHT' }, '2026-10-05', 1, later, sessions, holidays)[0]!.skipped).toBe('already over')
  })

  it('skips the overnight session that the holiday calendar closes', () => {
    const runs = planWindows({ kind: 'OVERNIGHT' }, '2026-11-25', 2, Date.parse('2026-11-25T12:00:00Z'), sessions, holidays)
    expect(runs[0]!.skipped).toMatch(/no overnight session on 2026-11-25/)
    expect(runs[1]!.skipped).toBeUndefined()
    expect(iso(runs[1]!.startMs)).toBe('2026-11-27T01:00:00.000Z')
  })

  it('ends an after-hours window early when the calendar closes early', () => {
    const runs = planWindows({ kind: 'PRE_MARKET' }, '2026-11-27', 1, Date.parse('2026-11-27T08:00:00Z'), sessions, holidays)
    expect(runs[0]!.closeRule).toBe('CONVERGENCE')
    expect(iso(runs[0]!.endMs)).toBe('2026-11-27T14:30:00.000Z')
  })

  it('builds custom windows every day, rolling past midnight when the end is earlier', () => {
    const runs = planWindows({ kind: 'CUSTOM', customStart: '22:00', customEnd: '02:00' }, '2026-10-09', 3, monday, sessions, holidays)
    expect(runs.every((r) => !r.skipped)).toBe(true)
    expect(iso(runs[0]!.startMs)).toBe('2026-10-10T02:00:00.000Z')
    expect(iso(runs[0]!.endMs)).toBe('2026-10-10T06:00:00.000Z')
    expect(runs[0]!.closeRule).toBe('AT_END')
  })
})

describe('custom windows in the viewer\'s own time zone', () => {
  const monday = Date.parse('2026-10-05T12:00:00Z')

  it('converts wall-clock times in any zone, on both sides of a clock change', () => {
    expect(iso(fromZone('2026-10-07', '21:00', 'Asia/Kolkata'))).toBe('2026-10-07T15:30:00.000Z')
    expect(iso(fromZone('2026-10-31', '09:00', 'America/Los_Angeles'))).toBe('2026-10-31T16:00:00.000Z')
    expect(iso(fromZone('2026-11-01', '09:00', 'America/Los_Angeles'))).toBe('2026-11-01T17:00:00.000Z')
    expect(iso(fromZone('2026-10-07', '20:00', 'America/New_York'))).toBe(iso(fromEastern('2026-10-07', '20:00')))
  })

  it('knows the calendar date in a zone', () => {
    expect(dateInZone(Date.parse('2026-10-07T20:00:00Z'), 'Asia/Kolkata')).toBe('2026-10-08')
    expect(dateInZone(Date.parse('2026-10-07T20:00:00Z'), 'America/New_York')).toBe('2026-10-07')
  })

  it('tells a real zone from a made-up one', () => {
    expect(isTimeZone('Asia/Singapore')).toBe(true)
    expect(isTimeZone('Mars/Olympus')).toBe(false)
  })

  it('keeps a local window at the same local time when New York changes its clocks', () => {
    const runs = planWindows({ kind: 'CUSTOM', customStart: '21:00', customEnd: '22:00', timeZone: 'Asia/Kolkata' }, '2026-10-30', 4, monday, sessions, holidays)
    expect(runs.map((r) => iso(r.startMs))).toEqual([
      '2026-10-30T15:30:00.000Z',
      '2026-10-31T15:30:00.000Z',
      '2026-11-01T15:30:00.000Z',
      '2026-11-02T15:30:00.000Z',
    ])
    expect(runs.every((r) => r.endMs - r.startMs === 3_600_000 && r.closeRule === 'AT_END')).toBe(true)
  })

  it('rolls a local window past midnight to the next local day', () => {
    const runs = planWindows({ kind: 'CUSTOM', customStart: '23:30', customEnd: '00:15', timeZone: 'Asia/Singapore' }, '2026-10-08', 1, monday, sessions, holidays)
    expect(iso(runs[0]!.startMs)).toBe('2026-10-08T15:30:00.000Z')
    expect(iso(runs[0]!.endMs)).toBe('2026-10-08T16:15:00.000Z')
  })
})
