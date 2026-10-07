// Drives scheduled plans: every few seconds, open the runs whose window has started and
// finish the runs whose policies have all ended.

import type { Context } from '../context'
import type { PlanService } from '../plans/plan.service'

const INTERVAL_MS = 15_000

export class ScheduleWorker {
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    private readonly ctx: Context,
    private readonly plans: PlanService,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS)
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      await this.plans.tick()
    } catch (error) {
      this.ctx.log.error({ err: error }, 'schedule tick failed')
    } finally {
      this.running = false
    }
  }
}
