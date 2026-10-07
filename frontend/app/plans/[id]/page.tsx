'use client'

// A scheduled plan: its runs, and the protection opened for each stock in each run.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { ErrorCard } from '@/components/error-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { api, ApiError } from '@/lib/api'
import { bpsPercent, PLAN_RUN_LABEL } from '@/lib/format'
import { etAndLocal, localDay, plainStatus, ticker, TONE_CLASS, WHEN_OPTIONS } from '@/lib/plain'

export default function PlanPage() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const detail = useQuery({ queryKey: ['plan', id], queryFn: () => api.plan(id), refetchInterval: 10_000 })
  const [confirm, setConfirm] = useState(false)
  const cancel = useMutation({
    mutationFn: () => api.cancelPlan(id),
    onSuccess: () => {
      toast.success('Plan cancelled')
      setConfirm(false)
      void queryClient.invalidateQueries({ queryKey: ['plan', id] })
      void queryClient.invalidateQueries({ queryKey: ['plans'] })
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : (e as Error).message),
  })

  if (detail.isError) return <ErrorCard title="Plan not found" message={(detail.error as Error).message} />
  if (!detail.data) return <Skeleton className="h-64 w-full" />
  const { plan, runs, policies } = detail.data
  const byRun = new Map<string, typeof policies>()
  for (const p of policies) byRun.set(p.policy.planRunId ?? '', [...(byRun.get(p.policy.planRunId ?? '') ?? []), p])

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Scheduled protection</p>
          <h1 className="text-3xl font-semibold">{plan.stockSymbols.map(ticker).join(', ')}</h1>
          <p className="text-sm text-muted-foreground">
            {WHEN_OPTIONS.find((w) => w.kind === plan.windowKind)?.label}
            {plan.windowKind === 'CUSTOM' ? ` ${plan.customStart} to ${plan.customEnd} New York time` : ''} · {bpsPercent(plan.protectionBps)} covered · {plan.days === 1 ? 'once' : `${plan.days} days`}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline">{plan.status.toLowerCase()}</Badge>
          {plan.status === 'ACTIVE' && (
            <Button size="sm" variant="destructive" onClick={() => setConfirm(true)}>
              Stop
            </Button>
          )}
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Days</CardTitle>
          <CardDescription>Cover is set at the start of each window and lifted at its end.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y text-sm">
          {runs.map((run) => (
            <div key={run.id} className="flex flex-col gap-1 py-3">
              <div className="flex flex-wrap items-center gap-x-3">
                <span className="w-28 shrink-0 text-xs">{localDay(run.windowStart ?? new Date(run.runDate + 'T12:00:00Z').toISOString())}</span>
                <Badge variant={run.status === 'OPEN' ? 'default' : 'outline'}>{PLAN_RUN_LABEL[run.status] ?? run.status}</Badge>
                {run.windowStart ? (
                  <span>
                    {etAndLocal(run.windowStart)} to {etAndLocal(run.windowEnd)}
                    {run.closeRule === 'CONVERGENCE' ? ' · lifted once prices settle after the open' : ''}
                  </span>
                ) : null}
                {run.note && <span className="text-muted-foreground">{run.note}</span>}
              </div>
              {(byRun.get(run.id) ?? []).map(({ policy, leg }) => (
                <Link key={policy.id} href={`/protection/${policy.id}`} className="flex flex-wrap gap-x-3 pl-[6.75rem] hover:underline">
                  <span className="font-medium">{ticker(leg.stockSymbol)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${TONE_CLASS[plainStatus(policy.status).tone]}`}>{plainStatus(policy.status).text}</span>
                  <span className="text-muted-foreground">{bpsPercent(policy.actualProtectionBps || policy.requestedProtectionBps)}</span>
                  {policy.failureReason && <span className="text-destructive">{policy.failureReason}</span>}
                </Link>
              ))}
              {run.results &&
                Object.entries(run.results)
                  .filter(([, r]) => r.error && !r.policyId)
                  .map(([symbol, r]) => (
                    <p key={symbol} className="pl-[6.75rem] text-destructive">
                      {ticker(symbol)}: {r.error}
                    </p>
                  ))}
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stop this schedule?</DialogTitle>
            <DialogDescription>Future days are dropped and any cover in place right now is lifted.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="destructive" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              {cancel.isPending ? 'Stopping…' : 'Stop schedule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
