// PRD sections 29 and 30: the current US equity session and the reopen a protection waits for.

import { nextStateStart, sessionAt, type SessionInfo, type SessionState } from '@prox/core'
import type { Backpack } from '../backpack'
import type { ProtectionMode } from '../db/types'

export interface SessionSnapshot extends SessionInfo {
  at: string
  nextRegularOpen: string | null
  nextWeekendStart: string | null
}

export class MarketSessionService {
  constructor(private readonly backpack: Backpack) {}

  async current(now = Date.now()): Promise<SessionSnapshot> {
    const { sessions, holidays } = await this.backpack.stocks.calendar()
    const info = sessionAt(now, sessions, holidays)
    const nextRegular = nextStateStart(now, 'REGULAR', sessions, holidays)
    const nextWeekend = nextStateStart(now, 'WEEKEND', sessions, holidays)
    return {
      ...info,
      at: new Date(now).toISOString(),
      nextRegularOpen: nextRegular === null ? null : new Date(nextRegular).toISOString(),
      nextWeekendStart: nextWeekend === null ? null : new Date(nextWeekend).toISOString(),
    }
  }

  async stateAt(ms: number): Promise<SessionState> {
    const { sessions, holidays } = await this.backpack.stocks.calendar()
    return sessionAt(ms, sessions, holidays).state
  }

  /**
   * When the cash market reopens for this mode. TONIGHT is the next regular open. WEEKEND is the
   * first regular open after the coming weekend. CUSTOM is the time the user chose.
   */
  async reopenFor(mode: ProtectionMode, now: number, customEndAt?: Date): Promise<Date> {
    if (mode === 'CUSTOM') {
      if (!customEndAt || customEndAt.getTime() <= now) throw new Error('A custom protection needs an end time in the future')
      return customEndAt
    }
    const { sessions, holidays } = await this.backpack.stocks.calendar()
    let from = now
    if (mode === 'WEEKEND' && sessionAt(now, sessions, holidays).state !== 'WEEKEND') {
      const weekendStart = nextStateStart(now, 'WEEKEND', sessions, holidays)
      if (weekendStart === null) throw new Error('No weekend found within the lookahead window')
      from = weekendStart
    }
    const reopen = nextStateStart(from, 'REGULAR', sessions, holidays)
    if (reopen === null) throw new Error('No regular session found within the lookahead window')
    return new Date(reopen)
  }
}
