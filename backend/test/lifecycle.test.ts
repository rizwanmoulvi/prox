import { describe, expect, it } from 'vitest'
import type { Policy } from '../src/db/types'
import { checksCountFrom, hedgedStatus, nextLifecycleStatus } from '../src/protection/lifecycle'

const base: Policy = {
  id: 'p1',
  status: 'ACTIVE',
  riskState: 'SAFE',
  mode: 'WEEKEND',
  requestedProtectionBps: 10_000,
  actualProtectionBps: 10_000,
  startAt: new Date('2026-10-09T19:00:00Z'),
  reopenAt: new Date('2026-10-12T13:30:00Z'),
  maxEndAt: new Date('2026-10-12T15:35:00Z'),
  cooldownSec: 300,
  demoOverride: false,
  closeReason: null,
  failureReason: null,
  ownerWallet: 'w',
  receipt: null,
  planRunId: null,
  closeRule: 'CONVERGENCE',
  createdAt: new Date(),
  updatedAt: new Date(),
}
const at = (iso: string) => Date.parse(iso)

// PRD section 34: ACTIVE -> WAIT_REOPEN -> WAIT_CONVERGENCE, with EXPIRED as the hard stop.
describe('nextLifecycleStatus', () => {
  it('stays ACTIVE while the cash market is still open on Friday', () => {
    expect(nextLifecycleStatus(base, at('2026-10-09T19:00:00Z'), 'REGULAR')).toBeNull()
  })

  it('moves to WAIT_REOPEN once the market closes', () => {
    expect(nextLifecycleStatus(base, at('2026-10-09T20:30:00Z'), 'POSTMARKET')).toBe('WAIT_REOPEN')
    expect(nextLifecycleStatus(base, at('2026-10-10T12:00:00Z'), 'WEEKEND')).toBe('WAIT_REOPEN')
  })

  it('stays in WAIT_REOPEN over the weekend', () => {
    expect(nextLifecycleStatus({ ...base, status: 'WAIT_REOPEN' }, at('2026-10-11T12:00:00Z'), 'WEEKEND')).toBeNull()
  })

  it('moves to WAIT_CONVERGENCE at the reopen', () => {
    expect(nextLifecycleStatus({ ...base, status: 'WAIT_REOPEN' }, at('2026-10-12T13:30:00Z'), 'REGULAR')).toBe('WAIT_CONVERGENCE')
    expect(nextLifecycleStatus({ ...base, status: 'WAIT_CONVERGENCE' }, at('2026-10-12T13:40:00Z'), 'REGULAR')).toBeNull()
  })

  it('goes back to ACTIVE if the market opens again before the target reopen', () => {
    const thursdayNight = { ...base, status: 'WAIT_REOPEN' as const, startAt: new Date('2026-10-08T23:00:00Z') }
    expect(nextLifecycleStatus(thursdayNight, at('2026-10-09T14:00:00Z'), 'REGULAR')).toBe('ACTIVE')
    expect(nextLifecycleStatus({ ...thursdayNight, actualProtectionBps: 6000 }, at('2026-10-09T14:00:00Z'), 'REGULAR')).toBe('PARTIAL')
  })

  it('expires at the hard stop whatever the session', () => {
    expect(nextLifecycleStatus({ ...base, status: 'WAIT_CONVERGENCE' }, at('2026-10-12T15:35:00Z'), 'REGULAR')).toBe('EXPIRED')
  })

  it('treats a demo reopen as the market having reopened', () => {
    expect(nextLifecycleStatus({ ...base, demoOverride: true }, at('2026-10-10T12:00:00Z'), 'WEEKEND')).toBe('WAIT_CONVERGENCE')
  })

  it('closes a custom end time at that time, through closed sessions, with no oracle wait', () => {
    const custom = { ...base, mode: 'CUSTOM' as const, closeRule: 'AT_END' as const, reopenAt: new Date('2026-10-10T12:00:00Z'), maxEndAt: new Date('2026-10-10T12:00:00Z') }
    expect(nextLifecycleStatus(custom, at('2026-10-10T11:00:00Z'), 'WEEKEND')).toBeNull()
    expect(nextLifecycleStatus(custom, at('2026-10-10T12:00:00Z'), 'WEEKEND')).toBe('EXPIRED')
  })

  it('keeps an at-end window ACTIVE through closed sessions and expires it at the window end', () => {
    const atEnd = { ...base, closeRule: 'AT_END' as const, mode: 'WINDOW' as const, reopenAt: new Date('2026-10-07T00:00:00Z'), maxEndAt: new Date('2026-10-07T00:00:00Z') }
    expect(nextLifecycleStatus(atEnd, at('2026-10-06T21:00:00Z'), 'POSTMARKET')).toBeNull()
    expect(nextLifecycleStatus(atEnd, at('2026-10-07T00:00:00Z'), 'OVERNIGHT')).toBe('EXPIRED')
  })

  it('leaves finished or in-flight policies alone', () => {
    expect(nextLifecycleStatus({ ...base, status: 'CLOSING' }, at('2026-10-12T15:35:00Z'), 'REGULAR')).toBeNull()
    expect(nextLifecycleStatus({ ...base, status: 'CLOSED' }, at('2026-10-12T15:35:00Z'), 'REGULAR')).toBeNull()
  })
})

describe('hedgedStatus and checksCountFrom', () => {
  it('is PARTIAL below the requested level', () => {
    expect(hedgedStatus({ requestedProtectionBps: 10_000, actualProtectionBps: 6000 })).toBe('PARTIAL')
    expect(hedgedStatus({ requestedProtectionBps: 10_000, actualProtectionBps: 10_000 })).toBe('ACTIVE')
  })

  it('adds the cooldown to the reopen', () => {
    expect(checksCountFrom(base)).toBe(at('2026-10-12T13:35:00Z'))
  })
})
