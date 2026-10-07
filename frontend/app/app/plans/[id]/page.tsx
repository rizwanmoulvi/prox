'use client'

// One schedule: the windows it covers, day by day, and the protection it opened for each stock.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { ErrorCard } from '@/components/error-card'
import { Loader } from '@/components/loader'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, ApiError, type PolicyWithLeg } from '@/lib/api'
import { bpsPercent, clock, dateOnly, dayLabel, myZone, nyTime, RUN_LABEL, scheduleHours, STATUS_LABEL, zoneLabel } from '@/lib/format'

const RUN_TONE: Record<string, string> = {
  OPEN: 'font-bold text-gold-deep',
  OPENING: 'font-bold text-gold-deep',
  FAILED: 'font-bold text-danger',
  DONE: 'text-ink',
  SCHEDULED: 'text-ink-soft',
  SKIPPED: 'text-ink-faint',
}

export default function PlanPage() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const detail = useQuery({ queryKey: ['plan', id], queryFn: () => api.plan(id), refetchInterval: 10_000 })
  const [confirm, setConfirm] = useState(false)
  const stop = useMutation({
    mutationFn: () => api.cancelPlan(id),
    onSuccess: () => {
      toast.success('Schedule stopped')
      setConfirm(false)
      void queryClient.invalidateQueries({ queryKey: ['plan', id] })
      void queryClient.invalidateQueries({ queryKey: ['plans'] })
      void queryClient.invalidateQueries({ queryKey: ['policies'] })
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : (e as Error).message),
  })

  if (detail.isError) return <ErrorCard title="Schedule not found" message={(detail.error as Error).message} />
  if (!detail.data) return <Loader label="Reading the schedule" />
  const { plan, runs, policies } = detail.data
  const byRun = new Map<string, PolicyWithLeg[]>()
  for (const item of policies) {
    const key = item.policy.planRunId ?? ''
    byRun.set(key, [...(byRun.get(key) ?? []), item])
  }
  const names = plan.stockSymbols.map(ticker).join(', ')
  const hours = scheduleHours(plan)
  const inNewYork = myZone() === 'America/New_York'
  const active = plan.status === 'ACTIVE'

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div>
          <Link href="/app" className="text-sm text-ink-soft">
            Portfolio
          </Link>
          <h1 className="mt-2 font-heading text-[clamp(2.2rem,6vw,3.2rem)] leading-[1.02] font-semibold tracking-[-0.6px]">
            {names}, {bpsPercent(plan.protectionBps)} protected
          </h1>
          <p className="mt-2 text-ink-soft">
            {hours}, {plan.days === 1 ? 'once' : `every day for ${plan.days} days`}. {active ? 'Running.' : plan.status === 'CANCELLED' ? 'Stopped.' : 'Finished.'}
          </p>
        </div>
        {active && (
          <Button variant="secondary" onClick={() => setConfirm(true)}>
            Stop the schedule
          </Button>
        )}
      </header>

      <section>
        <h2 className="font-heading text-[1.6rem] font-semibold tracking-[-0.3px]">Day by day</h2>
        <p className="mt-1 text-sm text-ink-soft">The hedge opens at the start of each window and closes at its end. Times are in your own time, {zoneLabel()}.</p>
        <ul className="mt-4">
          {runs.map((run) => (
            <li key={run.id} className="border-b border-line-soft py-4 last:border-b-0">
              <div className="grid grid-cols-[7rem_1fr_auto] items-baseline gap-x-4 gap-y-1">
                <span className="font-bold">{run.windowStart ? dayLabel(run.windowStart) : dateOnly(run.runDate)}</span>
                <span className="text-sm text-ink-soft">
                  {run.windowStart ? (
                    <>
                      {clock(run.windowStart)} to {clock(run.windowEnd)}
                      {!inNewYork && (
                        <span className="block text-[0.8rem] text-ink-faint">
                          {nyTime(run.windowStart)} to {nyTime(run.windowEnd)} in New York
                        </span>
                      )}
                      {run.closeRule === 'CONVERGENCE' && <span className="block text-[0.8rem] text-ink-faint">Closes after the open, once prices agree</span>}
                    </>
                  ) : (
                    run.note
                  )}
                </span>
                <span className={`text-sm ${RUN_TONE[run.status] ?? 'text-ink-soft'}`}>{RUN_LABEL[run.status] ?? run.status}</span>
              </div>
              {(byRun.get(run.id) ?? []).map(({ policy, leg }) => (
                <Link
                  key={policy.id}
                  href={policy.status === 'CLOSED' ? `/app/protection/${policy.id}/receipt` : `/app/protection/${policy.id}`}
                  className="mt-2 ml-0 flex flex-wrap items-baseline gap-x-3 rounded-md px-2 py-1.5 text-sm text-ink no-underline transition-colors duration-150 hover:bg-ink/[0.04] sm:ml-[7.5rem]"
                >
                  <span className="font-bold">{ticker(leg.stockSymbol)}</span>
                  <span className="text-ink-soft">{STATUS_LABEL[policy.status] ?? policy.status}</span>
                  {policy.failureReason && <span className="text-danger">{policy.failureReason}</span>}
                </Link>
              ))}
              {run.results &&
                Object.entries(run.results)
                  .filter(([, r]) => r.error && !r.policyId)
                  .map(([symbol, r]) => (
                    <p key={symbol} className="mt-2 text-sm text-danger sm:ml-[7.5rem]">
                      {ticker(symbol)}: {r.error}
                    </p>
                  ))}
            </li>
          ))}
        </ul>
      </section>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stop this schedule?</DialogTitle>
            <DialogDescription>No more windows will open. Any hedge it has open right now is closed straight away; the stocks stay in your account.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="destructive" disabled={stop.isPending} onClick={() => stop.mutate()}>
              {stop.isPending ? 'Stopping' : 'Stop the schedule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ticker(symbol: string): string {
  return symbol.replace(/\.US$/, '')
}
