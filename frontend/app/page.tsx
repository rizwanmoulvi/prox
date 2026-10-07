'use client'

// Home: what you hold, what is covered, one button to protect.

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'
import { ErrorCard } from '@/components/error-card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api, type Plan, type PolicyWithLeg } from '@/lib/api'
import { money } from '@/lib/format'
import { etAndLocal, plainStatus, ticker, TONE_CLASS, WHEN_OPTIONS } from '@/lib/plain'

const LIVE = new Set(['OPENING', 'ACTIVE', 'PARTIAL', 'WAIT_REOPEN', 'WAIT_CONVERGENCE', 'REDUCING', 'EMERGENCY', 'EXPIRED', 'CLOSING'])

export default function HomePage() {
  const portfolio = useQuery({ queryKey: ['portfolio'], queryFn: api.portfolio, refetchInterval: 15_000 })
  const policies = useQuery({ queryKey: ['policies'], queryFn: api.policies, refetchInterval: 15_000 })
  const plans = useQuery({ queryKey: ['plans'], queryFn: api.plans, refetchInterval: 15_000 })
  const markets = useQuery({ queryKey: ['markets'], queryFn: api.markets, refetchInterval: 30_000 })
  const [selected, setSelected] = useState<string[]>([])

  if (portfolio.isError) return <ErrorCard title="Could not read your account" message={(portfolio.error as Error).message} />
  if (!portfolio.data) return <Skeleton className="h-64 w-full" />

  const live = (policies.data ?? []).filter((p) => LIVE.has(p.policy.status))
  const activePlans = (plans.data ?? []).filter((p) => p.status === 'ACTIVE')
  const holdings = portfolio.data.holdings
  const stockValue = holdings.reduce((sum, h) => sum + Number(h.marketValue), 0)
  const coveredValue = live.reduce((sum, p) => sum + Number(p.leg.stockMarketValue) * (p.policy.actualProtectionBps / 10_000), 0)
  const usdc = portfolio.data.otherAssets.find((a) => a.symbol === 'USDC')
  const eligible = new Set((markets.data ?? []).filter((m) => m.eligible).map((m) => m.symbol))
  const toggle = (s: string) => setSelected((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))
  const chosen = selected.filter((s) => eligible.has(s))

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-10">
      <section className="grid gap-6 sm:grid-cols-3">
        <Big label="Your stocks" value={money(stockValue)} />
        <Big label="Covered right now" value={money(coveredValue)} tone={coveredValue > 0 ? 'good' : undefined} />
        <Big label="Protection balance" value={money(usdc?.quantity ?? 0)} hint="USDC that settles the cost" />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Stocks</h2>
          <span className="text-sm text-muted-foreground">Tap to choose what to protect</span>
        </div>
        {holdings.length === 0 && <p className="text-sm text-muted-foreground">No tokenized stocks in the account yet.</p>}
        <ul className="divide-y rounded-xl border">
          {holdings.map((h) => {
            const cover = live.find((p) => p.leg.stockSymbol === h.symbol)
            const planned = activePlans.find((p) => p.stockSymbols.includes(h.symbol))
            const canPick = eligible.has(h.symbol) && !cover
            const picked = selected.includes(h.symbol)
            return (
              <li key={h.symbol} className={`flex items-center gap-4 px-4 py-4 ${picked ? 'bg-muted' : ''}`}>
                <button onClick={() => canPick && toggle(h.symbol)} disabled={!canPick} className="flex min-w-0 flex-1 items-center gap-4 text-left disabled:cursor-default">
                  <span className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-xs ${picked ? 'border-foreground bg-foreground text-background' : canPick ? 'border-muted-foreground/40' : 'border-transparent'}`}>
                    {picked ? '✓' : ''}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="font-semibold">{ticker(h.symbol)}</span>
                      <span className="truncate text-sm text-muted-foreground">{h.name}</span>
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {h.quantity} shares · {money(h.marketValue)}
                    </span>
                  </span>
                </button>
                <span className="text-right text-sm">
                  {cover ? <CoverLine item={cover} /> : planned ? <PlanLine plan={planned} /> : <span className="text-muted-foreground">Not covered</span>}
                </span>
              </li>
            )
          })}
        </ul>
      </section>

      <ProtectBar selected={chosen} />

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Activity</h2>
          <Link href="/activity" className="text-sm text-muted-foreground hover:underline">
            See all
          </Link>
        </div>
        <ActivityList policies={(policies.data ?? []).slice(0, 4)} plans={activePlans.slice(0, 2)} />
      </section>
    </div>
  )
}

function Big({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'good' }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 text-3xl font-semibold tabular-nums ${tone === 'good' ? 'text-emerald-700 dark:text-emerald-300' : ''}`}>{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function CoverLine({ item }: { item: PolicyWithLeg }) {
  const s = plainStatus(item.policy.status)
  return (
    <Link href={`/protection/${item.policy.id}`} className="flex flex-col items-end gap-1">
      <span className={`rounded-full px-2 py-0.5 text-xs ${TONE_CLASS[s.tone]}`}>{s.text}</span>
      <span className="text-xs text-muted-foreground">until {etAndLocal(item.policy.reopenAt)}</span>
    </Link>
  )
}

function PlanLine({ plan }: { plan: Plan }) {
  const when = WHEN_OPTIONS.find((w) => w.kind === plan.windowKind)?.label ?? plan.windowKind
  return (
    <Link href={`/plans/${plan.id}`} className="flex flex-col items-end gap-1">
      <span className={`rounded-full px-2 py-0.5 text-xs ${TONE_CLASS.neutral}`}>Scheduled</span>
      <span className="text-xs text-muted-foreground">
        {when.toLowerCase()}, {plan.days === 1 ? 'once' : `${plan.days} days`}
      </span>
    </Link>
  )
}

function ProtectBar({ selected }: { selected: string[] }) {
  const href = selected.length ? `/protect?symbols=${encodeURIComponent(selected.join(','))}` : '/protect'
  return (
    <div className="sticky bottom-4 z-10 flex items-center justify-between gap-4 rounded-2xl border bg-background/95 p-4 shadow-lg backdrop-blur">
      <div className="text-sm">
        {selected.length ? (
          <>
            <span className="font-medium">{selected.map(ticker).join(', ')}</span>
            <span className="text-muted-foreground"> selected</span>
          </>
        ) : (
          <span className="text-muted-foreground">Choose stocks above, or protect everything</span>
        )}
      </div>
      <Button size="lg" nativeButton={false} render={<Link href={href} />}>
        {selected.length ? `Protect ${selected.length === 1 ? ticker(selected[0]!) : `${selected.length} stocks`}` : 'Protect'}
      </Button>
    </div>
  )
}

function ActivityList({ policies, plans }: { policies: PolicyWithLeg[]; plans: Plan[] }) {
  if (!policies.length && !plans.length) return <p className="text-sm text-muted-foreground">Nothing yet. Your first protection will show up here.</p>
  return (
    <ul className="divide-y rounded-xl border text-sm">
      {plans.map((p) => (
        <li key={p.id}>
          <Link href={`/plans/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/60">
            <span className="font-medium">{p.stockSymbols.map(ticker).join(', ')}</span>
            <span className="text-muted-foreground">
              {WHEN_OPTIONS.find((w) => w.kind === p.windowKind)?.label.toLowerCase()}, {p.days === 1 ? 'once' : `${p.days} days`}
            </span>
            <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${TONE_CLASS.neutral}`}>Scheduled</span>
          </Link>
        </li>
      ))}
      {policies.map(({ policy, leg }) => {
        const s = plainStatus(policy.status)
        return (
          <li key={policy.id}>
            <Link href={policy.status === 'CLOSED' ? `/protection/${policy.id}/receipt` : `/protection/${policy.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/60">
              <span className="font-medium">{ticker(leg.stockSymbol)}</span>
              <span className="text-muted-foreground">{etAndLocal(policy.startAt, true)}</span>
              <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${TONE_CLASS[s.tone]}`}>{s.text}</span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
