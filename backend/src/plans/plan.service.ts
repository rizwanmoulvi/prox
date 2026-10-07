// Scheduled protection: one plan covers several stocks across a span of days. The scheduler
// opens a policy per stock when a window starts; the monitor closes them at the window end or,
// for windows ending at the regular open, through the oracle.

import Decimal from 'decimal.js'
import { addDays, dateInZone, easternDate, isTimeZone, planWindows, type PlannedWindow, type WindowSpec } from '@prox/core'
import type { Context } from '../context'
import type { PlanRepo } from '../db/plans'
import { HEDGED_STATUSES, TERMINAL_STATUSES, type Plan, type PlanRun, type PolicyWithLeg } from '../db/types'
import { findPerp, type PreviewService } from '../protection/protection.preview'
import { sizeHedge } from '../protection/protection.math'
import type { ProtectionService } from '../protection/protection.service'

export interface PlanRequest {
  stockSymbols: string[]
  protectionBps: number
  window: WindowSpec
  days: number
  /** ET calendar date of the first day; defaults to today in ET. */
  startDate?: string
}

export interface PlanPreview {
  startDate: string
  runs: (PlannedWindow & { startIso: string | null; endIso: string | null })[]
  stocks: { symbol: string; name: string; quantity: string; notional: string; issues: string[] }[]
  totalNotionalPerRun: string
  /** The one leverage every stock opens at, from today's margin; null when it cannot be chosen. */
  leverage: number | null
  canCreate: boolean
  blockers: string[]
}

export class PlanBlocked extends Error {
  constructor(readonly blockers: string[]) {
    super(blockers.join('; '))
    this.name = 'PlanBlocked'
  }
}

export class PlanService {
  constructor(
    private readonly ctx: Context,
    private readonly plans: PlanRepo,
    private readonly protection: ProtectionService,
    private readonly previews: PreviewService,
  ) {}

  async preview(request: PlanRequest, now = Date.now()): Promise<PlanPreview> {
    const blockers: string[] = []
    if (!request.stockSymbols.length) blockers.push('Pick at least one stock')
    if (request.days < 1 || request.days > 60) blockers.push('Days must be between 1 and 60')
    if (request.window.kind === 'CUSTOM' && !(request.window.customStart && request.window.customEnd)) blockers.push('A custom window needs a start and an end time')
    if (!this.ctx.config.TRADING_ENABLED) blockers.push('Trading is switched off (TRADING_ENABLED=false)')

    // Custom hours may be in the user's own zone; the market sessions are always New York's.
    const zone = request.window.kind === 'CUSTOM' ? request.window.timeZone : undefined
    if (zone && !isTimeZone(zone)) blockers.push(`Unknown time zone: ${zone}`)
    const window: WindowSpec = { ...request.window, timeZone: zone && isTimeZone(zone) ? zone : undefined }
    let startDate = request.startDate ?? (window.timeZone ? dateInZone(now, window.timeZone) : easternDate(now))
    const { sessions, holidays } = await this.ctx.backpack.stocks.calendar()
    let planned = planWindows(window, startDate, request.days, now, sessions, holidays)
    // Today's window is already over: the user means the next one, so count the days from tomorrow.
    if (!request.startDate && planned[0]?.skipped === 'already over') {
      startDate = addDays(startDate, 1)
      planned = planWindows(window, startDate, request.days, now, sessions, holidays)
    }
    const runs = planned.map((r) => ({
      ...r,
      startIso: r.skipped ? null : new Date(r.startMs).toISOString(),
      endIso: r.skipped ? null : new Date(r.endMs).toISOString(),
    }))
    if (!runs.some((r) => !r.skipped)) blockers.push('No run falls inside the chosen days')

    const stocks = await this.checkStocks(request)
    const total = stocks.reduce((sum, s) => sum.plus(s.notional), new Decimal(0))
    if (total.gt(this.ctx.config.MAX_TOTAL_NOTIONAL_USD)) blockers.push(`One run would hedge $${total.toFixed(2)}, above MAX_TOTAL_NOTIONAL_USD=${this.ctx.config.MAX_TOTAL_NOTIONAL_USD}`)
    for (const s of stocks) for (const issue of s.issues) blockers.push(`${s.symbol}: ${issue}`)
    // Margin is read today; each run checks it again when its window opens.
    const group = request.stockSymbols.length > 1 ? await this.previews.previewGroup(request.stockSymbols, request.protectionBps) : null
    if (group) blockers.push(...group.blockers)

    return { startDate, runs, stocks, totalNotionalPerRun: total.toString(), leverage: group?.leverage ?? null, canCreate: blockers.length === 0, blockers }
  }

  async create(request: PlanRequest, ownerWallet: string): Promise<{ plan: Plan; runs: PlanRun[] }> {
    const preview = await this.preview(request)
    if (!preview.canCreate) throw new PlanBlocked(preview.blockers)
    const created = await this.plans.create(
      {
        ownerWallet,
        windowKind: request.window.kind,
        customStart: request.window.customStart ?? null,
        customEnd: request.window.customEnd ?? null,
        customTimeZone: request.window.kind === 'CUSTOM' ? (request.window.timeZone ?? null) : null,
        protectionBps: request.protectionBps,
        stockSymbols: request.stockSymbols,
        startDate: preview.startDate,
        days: request.days,
      },
      preview.runs.map((r) => ({
        runDate: r.date,
        windowStart: r.skipped ? null : new Date(r.startMs),
        windowEnd: r.skipped ? null : new Date(r.endMs),
        closeRule: r.closeRule,
        status: r.skipped ? 'SKIPPED' : 'SCHEDULED',
        note: r.skipped ?? null,
      })),
    )
    this.ctx.events.publish('plan.updated', { planId: created.plan.id })
    // Do not make the user wait for the next tick when the window is already open.
    void this.tick().catch((err) => this.ctx.log.error({ err }, 'plan tick after create failed'))
    return created
  }

  async get(id: string): Promise<{ plan: Plan; runs: PlanRun[]; policies: PolicyWithLeg[] } | null> {
    const found = await this.plans.get(id)
    if (!found) return null
    const policies = (await Promise.all(found.runs.map((r) => this.ctx.policies.forPlanRun(r.id)))).flat()
    return { ...found, policies }
  }

  /** Stops future runs and closes whatever this plan holds open right now. */
  async cancel(id: string): Promise<{ plan: Plan; runs: PlanRun[] }> {
    const found = await this.plans.get(id)
    if (!found) throw new Error(`Unknown plan ${id}`)
    await this.plans.updatePlan(id, { status: 'CANCELLED' })
    for (const run of found.runs) {
      if (run.status === 'SCHEDULED') await this.plans.updateRun(run.id, { status: 'SKIPPED', note: 'cancelled' })
      if (run.status === 'OPEN' || run.status === 'OPENING') {
        for (const item of await this.ctx.policies.forPlanRun(run.id)) {
          if (HEDGED_STATUSES.includes(item.policy.status) && item.policy.status !== 'CLOSING') {
            await this.protection.close(item.policy.id, 'MANUAL').catch((err) => this.ctx.log.error({ err, policyId: item.policy.id }, 'cancel close failed'))
          }
        }
        await this.plans.updateRun(run.id, { note: 'cancelled' })
      }
    }
    this.ctx.events.publish('plan.updated', { planId: id })
    return (await this.plans.get(id))!
  }

  /** Called by the scheduler: open due runs, finish runs whose policies have all ended. */
  async tick(now = new Date()): Promise<void> {
    for (const run of await this.plans.due(now)) {
      if (!run.windowEnd || run.windowEnd <= now) {
        await this.plans.updateRun(run.id, { status: 'SKIPPED', note: 'window passed before the backend could open it' })
        continue
      }
      if (await this.plans.claim(run.id, 'SCHEDULED', 'OPENING')) await this.openRun(run)
    }
    for (const run of await this.plans.open()) await this.settleRun(run)
    for (const plan of await this.plans.listActive()) {
      const runs = await this.plans.runs(plan.id)
      if (runs.every((r) => ['DONE', 'SKIPPED', 'FAILED'].includes(r.status))) {
        await this.plans.updatePlan(plan.id, { status: 'COMPLETED' })
        this.ctx.events.publish('plan.updated', { planId: plan.id })
      }
    }
  }

  private async openRun(run: PlanRun): Promise<void> {
    const found = await this.plans.get(run.planId)
    if (!found) return
    const { plan } = found
    const results = await this.protection.activateMany(
      plan.stockSymbols.map((stockSymbol) => ({ stockSymbol, protectionBps: plan.protectionBps, mode: 'WINDOW', windowEndAt: run.windowEnd!.toISOString(), closeRule: run.closeRule })),
      plan.ownerWallet,
      run.id,
    )
    const opened = Object.values(results).some((r) => r.policyId && !r.error)
    await this.plans.updateRun(run.id, { status: opened ? 'OPEN' : 'FAILED', results })
    this.ctx.events.publish('plan.updated', { planId: plan.id })
  }

  private async settleRun(run: PlanRun): Promise<void> {
    if (run.status === 'OPENING') return
    const policies = await this.ctx.policies.forPlanRun(run.id)
    if (policies.length && policies.every((p) => TERMINAL_STATUSES.includes(p.policy.status))) {
      await this.plans.updateRun(run.id, { status: 'DONE' })
      this.ctx.events.publish('plan.updated', { planId: run.planId })
    }
  }

  /** Eligibility per stock at the chosen level, without touching order limits (those are checked at open). */
  private async checkStocks(request: PlanRequest) {
    const [portfolio, markets, live] = await Promise.all([this.ctx.portfolio.get(), this.ctx.backpack.markets.list(), this.ctx.policies.listLive()])
    return Promise.all(
      request.stockSymbols.map(async (symbol) => {
        const issues: string[] = []
        const holding = portfolio.holdings.find((h) => h.symbol === symbol)
        const perp = findPerp(markets, symbol)
        if (!this.ctx.config.ALLOWED_SYMBOLS.includes(symbol)) issues.push('not in ALLOWED_SYMBOLS')
        if (!holding) issues.push('not held in the Backpack account')
        else if (new Decimal(holding.collateralWeight).lte(0)) issues.push('not accepted as collateral')
        if (!perp) issues.push('no perpetual market')
        else if (perp.orderBookState !== 'Open') issues.push(`order book ${perp.orderBookState}`)
        if (live.some((p) => p.leg.stockSymbol === symbol)) issues.push('a protection is already live')
        let notional = new Decimal(0)
        if (holding && perp) {
          const quote = await this.ctx.prices.perp(perp.symbol)
          const sizing = sizeHedge({
            stockQuantity: holding.quantity,
            stockMarkPrice: holding.markPrice,
            perpMarkPrice: quote.markPrice,
            protectionBps: request.protectionBps,
            existingShortQuantity: 0,
            stepSize: perp.filters.quantity.stepSize,
            minQuantity: perp.filters.quantity.minQuantity,
          })
          if (sizing.sizeIssue === 'BELOW_MINIMUM') issues.push(`below the perp minimum of ${perp.filters.quantity.minQuantity} at this level`)
          if (sizing.sizeIssue === 'OFF_GRID') issues.push(`cannot be sized exactly at this level (step ${perp.filters.quantity.stepSize})`)
          notional = sizing.additionalNotional
          if (notional.gt(this.ctx.config.MAX_POSITION_NOTIONAL_USD)) issues.push(`$${notional.toFixed(2)} exceeds MAX_POSITION_NOTIONAL_USD`)
        }
        return { symbol, name: holding?.name ?? symbol, quantity: holding?.quantity ?? '0', notional: notional.toString(), issues }
      }),
    )
  }
}
