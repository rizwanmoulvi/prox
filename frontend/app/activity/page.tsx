'use client'

// Every plan and every protection, newest first.

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { ErrorCard } from '@/components/error-card'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import { money } from '@/lib/format'
import { etAndLocal, plainStatus, ticker, TONE_CLASS, WHEN_OPTIONS } from '@/lib/plain'

export default function ActivityPage() {
  const policies = useQuery({ queryKey: ['policies'], queryFn: api.policies, refetchInterval: 15_000 })
  const plans = useQuery({ queryKey: ['plans'], queryFn: api.plans, refetchInterval: 15_000 })
  if (policies.isError) return <ErrorCard title="Could not load activity" message={(policies.error as Error).message} />
  if (!policies.data || !plans.data) return <Skeleton className="h-64 w-full" />

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-10">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Scheduled</h2>
        {plans.data.length === 0 && <p className="text-sm text-muted-foreground">No schedules.</p>}
        <ul className="divide-y rounded-xl border text-sm">
          {plans.data.map((p) => (
            <li key={p.id}>
              <Link href={`/plans/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/60">
                <span className="font-medium">{p.stockSymbols.map(ticker).join(', ')}</span>
                <span className="text-muted-foreground">
                  {WHEN_OPTIONS.find((w) => w.kind === p.windowKind)?.label.toLowerCase()}, {p.days === 1 ? 'once' : `${p.days} days`}
                </span>
                <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${p.status === 'ACTIVE' ? TONE_CLASS.good : TONE_CLASS.neutral}`}>{p.status.toLowerCase()}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Protections</h2>
        {policies.data.length === 0 && <p className="text-sm text-muted-foreground">No protections yet.</p>}
        <ul className="divide-y rounded-xl border text-sm">
          {policies.data.map(({ policy, leg }) => {
            const s = plainStatus(policy.status)
            const net = policy.receipt ? Number(policy.receipt.trackingDifference) : null
            return (
              <li key={policy.id}>
                <Link href={policy.status === 'CLOSED' ? `/protection/${policy.id}/receipt` : `/protection/${policy.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/60">
                  <span className="font-medium">{ticker(leg.stockSymbol)}</span>
                  <span className="text-muted-foreground">{etAndLocal(policy.startAt, true)}</span>
                  {net !== null && <span className="text-muted-foreground">net {net >= 0 ? '+' : ''}{money(net, true)}</span>}
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${TONE_CLASS[s.tone]}`}>{s.text}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
