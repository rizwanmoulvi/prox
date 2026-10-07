'use client'

// One protection while it is live and after: the result so far, where it is in its life, the
// account's margin, and the record of everything that happened.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Anchors } from '@/components/anchors-list'
import { ErrorCard } from '@/components/error-card'
import { Loader } from '@/components/loader'
import { MarginMeter } from '@/components/margin-meter'
import { PnlChart } from '@/components/pnl-chart'
import { ResultEquation } from '@/components/result-equation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LineRow } from '@/components/umbra'
import { useStream } from '@/hooks/use-stream'
import { api, ApiError, type PnlPoint, type PolicyDetail } from '@/lib/api'
import { basis, bpsPercent, money, SESSION_LABEL, STATUS_LABEL, when, whenShort } from '@/lib/format'

const CAN_CLOSE = new Set(['ACTIVE', 'PARTIAL', 'WAIT_REOPEN', 'WAIT_CONVERGENCE', 'EXPIRED', 'EMERGENCY', 'CLOSING'])
const CAN_DEMO = new Set(['ACTIVE', 'PARTIAL', 'WAIT_REOPEN'])

// The four stages a protection passes through, and which statuses belong to each.
const STAGES: { label: string; statuses: string[] }[] = [
  { label: 'Hedge open', statuses: ['VALIDATING', 'READY', 'OPENING', 'ACTIVE', 'PARTIAL', 'REDUCING'] },
  { label: 'Waiting for the market', statuses: ['WAIT_REOPEN'] },
  { label: 'Waiting for prices to agree', statuses: ['WAIT_CONVERGENCE'] },
  { label: 'Closed', statuses: ['CLOSING', 'CLOSED', 'EXPIRED', 'EMERGENCY'] },
]

export default function ProtectionPage() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const detail = useQuery({ queryKey: ['policy', id], queryFn: () => api.policy(id), refetchInterval: 10_000 })
  const health = useQuery({ queryKey: ['policy-health', id], queryFn: () => api.policyHealth(id), refetchInterval: 10_000 })
  const appHealth = useQuery({ queryKey: ['health'], queryFn: api.health })
  const stream = useStream(true)
  const [confirmClose, setConfirmClose] = useState(false)

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['policy', id] })
    void queryClient.invalidateQueries({ queryKey: ['policies'] })
  }
  const close = useMutation({
    mutationFn: () => api.close(id),
    onSuccess: () => {
      toast.success('Close sent to Backpack')
      setConfirmClose(false)
      refresh()
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : (e as Error).message),
  })
  const demoReopen = useMutation({
    mutationFn: () => api.demoReopen(id),
    onSuccess: () => {
      toast.success('Treating the market as open. Price checks start now.')
      refresh()
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : (e as Error).message),
  })

  const live = stream.pnl[id]
  const points = useMemo<PnlPoint[]>(() => {
    const base = detail.data?.pnl ?? []
    if (!live) return base
    return [...base, { at: new Date().toISOString(), ...live }]
  }, [detail.data?.pnl, live])

  if (detail.isError) return <ErrorCard title="Protection not found" message={(detail.error as Error).message} />
  if (!detail.data) return <Loader label="Reading the protection" />
  const { policy, leg } = detail.data
  const ticker = leg.stockSymbol.replace(/\.US$/, '')
  const underlyingPnl = Number(live?.underlyingPnl ?? lastOf(detail.data.pnl)?.underlyingPnl ?? 0)
  const hedgePnl = Number(live?.hedgePnl ?? leg.pnl)
  const costs = Number(live?.costs ?? Number(leg.fees) - Number(leg.funding))
  const net = underlyingPnl + hedgePnl - costs
  const failed = policy.status === 'FAILED'
  const stage = STAGES.findIndex((s) => s.statuses.includes(policy.status))
  const done = policy.status === 'CLOSED'

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div>
          <Link href="/app" className="text-sm text-ink-soft">
            Portfolio
          </Link>
          <h1 className="mt-2 font-heading text-[clamp(2.2rem,6vw,3.2rem)] leading-[1.02] font-semibold tracking-[-0.6px]">
            {ticker}, {bpsPercent(policy.actualProtectionBps || policy.requestedProtectionBps)} protected
          </h1>
          <p className="mt-2 text-ink-soft">
            {STATUS_LABEL[policy.status] ?? policy.status}. {money(leg.stockMarketValue)} of stock, opened {when(policy.startAt)}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {done && (
            <Button nativeButton={false} render={<Link href={`/app/protection/${id}/receipt`} />}>
              View receipt
            </Button>
          )}
          {appHealth.data?.demoMode && CAN_DEMO.has(policy.status) && (
            <Button variant="outline" disabled={demoReopen.isPending} onClick={() => demoReopen.mutate()} title="Demo mode: act as if the market had reopened">
              Treat market as open
            </Button>
          )}
          {CAN_CLOSE.has(policy.status) && (
            <Button variant="secondary" onClick={() => setConfirmClose(true)}>
              Close now
            </Button>
          )}
        </div>
      </header>

      {failed && (
        <p className="border-l-2 border-danger pl-4 leading-relaxed text-danger">The hedge was not opened. {policy.failureReason ?? 'The order did not fill.'} Nothing is owed and the stock is untouched.</p>
      )}
      {policy.status === 'PARTIAL' && (
        <p className="border-l-2 border-gold pl-4 leading-relaxed text-ink-soft">
          Only {leg.actualQuantity} of {leg.targetQuantity} filled, so {bpsPercent(policy.actualProtectionBps)} is protected, not {bpsPercent(policy.requestedProtectionBps)}.
        </p>
      )}
      {policy.demoOverride && <p className="border-l-2 border-gold pl-4 leading-relaxed text-ink-soft">Demo: this protection is treating the market as open. Prices and orders are real.</p>}

      {!failed && (
        <section aria-label="Result so far">
          <ResultEquation stock={underlyingPnl} hedge={hedgePnl} costs={costs} net={net} />
        </section>
      )}

      {!failed && (
        <ol className="grid gap-x-3 gap-y-4 sm:grid-cols-4" aria-label="Progress">
          {STAGES.map((s, i) => {
            const reached = i <= stage
            const current = i === stage && !done
            return (
              <li key={s.label} aria-current={current ? 'step' : undefined}>
                <span className={`block h-1.5 rounded-full ${reached ? (current ? 'bg-gold' : 'bg-ink') : 'bg-paper-3'}`} />
                <span className={`mt-2 block text-sm ${current ? 'font-bold text-ink' : reached ? 'text-ink' : 'text-ink-faint'}`}>{s.label}</span>
                {i === 2 && leg.convergenceCount > 0 && <span className="block text-[0.8rem] text-ink-soft">{leg.convergenceCount} checks passed in a row</span>}
                {i === 1 && policy.status === 'WAIT_REOPEN' && <span className="block text-[0.8rem] text-ink-soft">Window ends {whenShort(policy.reopenAt)}</span>}
              </li>
            )
          })}
        </ol>
      )}

      <div className="grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h2 className="font-heading text-[1.6rem] font-semibold tracking-[-0.3px]">Stock against hedge</h2>
            <p className="text-sm text-ink-soft">
              Stock {money(live?.stockPrice ?? leg.currentStockPrice ?? leg.stockMarkPrice)}, perp {money(live?.perpPrice ?? leg.currentPerpPrice ?? leg.entryPrice)}
              {stream.connected && !done ? ', live' : ''}
            </p>
          </div>
          <div className="mt-4">
            {points.length > 1 ? <PnlChart points={points} /> : <p className="max-w-md leading-relaxed text-ink-soft">The chart starts once two readings are in. One is recorded every 30 seconds.</p>}
          </div>
        </section>

        <aside className="lg:border-l lg:border-line lg:pl-10">
          {health.data ? (
            <>
              <MarginMeter mmr={health.data.mmr} risk={health.data.riskState} />
              <div className="mt-5">
                <LineRow label="Gap between perp and stock" value={basis(stream.basis[id]?.basisBps ?? health.data.basisBps)} />
                <LineRow label="Net equity" value={money(health.data.netEquity)} />
                <LineRow label="Free margin" value={money(health.data.netEquityAvailable)} />
                <LineRow label="Borrowed" value={money(health.data.borrowLiability)} />
                <LineRow label="Leverage used" value={`${health.data.executionLeverage}x of ${health.data.accountLeverageLimit}x`} />
                <LineRow label="Closes by" value={whenShort(policy.maxEndAt)} />
              </div>
            </>
          ) : (
            <Loader compact />
          )}
        </aside>
      </div>

      <Tabs defaultValue="timeline">
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="checks">Price checks</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="anchors">On Solana</TabsTrigger>
        </TabsList>
        <TabsContent value="timeline" className="pt-4">
          <Timeline detail={detail.data} />
        </TabsContent>
        <TabsContent value="checks" className="pt-4">
          <Checks detail={detail.data} />
        </TabsContent>
        <TabsContent value="orders" className="pt-4">
          <Orders detail={detail.data} />
        </TabsContent>
        <TabsContent value="anchors" className="pt-4">
          <Anchors detail={detail.data} />
        </TabsContent>
      </Tabs>

      <Dialog open={confirmClose} onOpenChange={setConfirmClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close the hedge now?</DialogTitle>
            <DialogDescription>
              ProX buys back {leg.actualQuantity} {leg.perpSymbol.replace(/(\.US)?_USDC_PERP$/, '')} perp on Backpack at the current price. Your stock stays in the account and is no longer protected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClose(false)}>
              Keep it open
            </Button>
            <Button variant="destructive" disabled={close.isPending} onClick={() => close.mutate()}>
              {close.isPending ? 'Closing the hedge' : 'Close the hedge'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Turns the stored detail of a state change into a short sentence. */
function describe(detail: Record<string, unknown> | null): string {
  if (!detail) return ''
  const d = detail
  const parts: string[] = []
  if (d.filled !== undefined) parts.push(`Filled ${d.filled}${d.entryPrice ? ` at ${money(d.entryPrice as string)}` : ''}`)
  if (d.orderQuantity !== undefined) parts.push(`Order of ${d.orderQuantity}${d.leverage ? ` at ${d.leverage}x leverage` : ''}`)
  if (d.reason !== undefined) parts.push(`Reason: ${String(d.reason).toLowerCase().replace(/_/g, ' ')}`)
  if (d.session !== undefined) parts.push(`Session: ${(SESSION_LABEL[String(d.session)] ?? String(d.session)).toLowerCase()}`)
  if (d.exitPrice) parts.push(`Bought back at ${money(d.exitPrice as string)}`)
  if (d.realizedPnl !== undefined) parts.push(`hedge result ${money(d.realizedPnl as string, true)}`)
  if (d.riskState !== undefined) parts.push(`Risk now ${String(d.riskState).toLowerCase()}`)
  if (d.demoReopen) parts.push('Demo: market treated as open')
  if (d.toProtectionBps !== undefined) parts.push(`Reduced to ${bpsPercent(Number(d.toProtectionBps))}`)
  if (d.externalClose || d.externalReduction) parts.push('The short was changed on Backpack outside ProX')
  if (d.error) parts.push(String(d.error))
  return parts.join(', ')
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="max-w-md leading-relaxed text-ink-soft">{children}</p>
}

function Timeline({ detail }: { detail: PolicyDetail }) {
  return (
    <ol>
      {[...detail.events].reverse().map((e) => (
        <li key={e.id} className="grid gap-x-6 border-b border-line-soft py-3 last:border-b-0 sm:grid-cols-[10rem_14rem_1fr]">
          <span className="text-sm text-ink-soft">{whenShort(e.at)}</span>
          <span className="font-bold">{STATUS_LABEL[e.toStatus] ?? e.toStatus}</span>
          <span className="text-sm text-ink-soft">{describe(e.detail)}</span>
        </li>
      ))}
    </ol>
  )
}

function Checks({ detail }: { detail: PolicyDetail }) {
  if (detail.checks.length === 0) return <Empty>No price checks yet. The oracle starts checking once the window has ended and the market is open.</Empty>
  return (
    <>
      <p className="mb-3 max-w-[62ch] text-sm leading-relaxed text-ink-soft">
        Each row is one signed reading from the Chainlink oracle. A reading counts only when the market is open, the wait after the open has passed, and it matches the prices ProX sees itself.
      </p>
      <ol>
        {[...detail.checks].reverse().map((c) => (
          <li key={c.id} className="grid grid-cols-[1fr_auto] gap-x-6 border-b border-line-soft py-3 last:border-b-0 sm:grid-cols-[10rem_8rem_8rem_1fr]">
            <span className="text-sm text-ink-soft">{whenShort(c.observedAt)}</span>
            <span className="text-right font-mono text-[0.9rem] sm:text-left">{basis(c.basisBps)}</span>
            <span className="text-sm text-ink-soft">{SESSION_LABEL[c.session] ?? c.session}</span>
            <span className={`text-right text-sm font-bold sm:text-left ${!c.counted ? 'text-ink-faint' : c.passed ? 'text-gold-deep' : 'text-ink'}`}>
              {!c.counted ? `Not counted: ${c.rejectReason?.toLowerCase().replace(/_/g, ' ')}` : c.passed ? `Passed, ${c.countAfter} in a row` : 'Too wide, count reset'}
            </span>
          </li>
        ))}
      </ol>
    </>
  )
}

function Orders({ detail }: { detail: PolicyDetail }) {
  if (detail.orders.length === 0) return <Empty>No orders have been sent for this protection.</Empty>
  return (
    <ol>
      {detail.orders.map((o) => (
        <li key={o.id} className="grid gap-x-6 gap-y-0.5 border-b border-line-soft py-3 last:border-b-0 sm:grid-cols-[10rem_14rem_1fr_auto]">
          <span className="text-sm text-ink-soft">{whenShort(o.createdAt)}</span>
          <span className="font-bold">
            {o.purpose === 'OPEN' ? 'Open' : o.purpose === 'REDUCE' ? 'Reduce' : 'Close'}: {o.side === 'Ask' ? 'sell' : 'buy'} {o.quantity}
          </span>
          <span className="text-sm text-ink-soft">
            Filled {o.executedQuantity}
            {o.avgPrice ? ` at ${money(o.avgPrice)}` : ''}, fee {money(o.fee, true)}
            {o.error ? <span className="text-danger">. {o.error}</span> : null}
          </span>
          <span className="text-sm text-ink-soft">{o.status.charAt(0) + o.status.slice(1).toLowerCase()}</span>
        </li>
      ))}
    </ol>
  )
}

function lastOf<T>(items: T[]): T | undefined {
  return items[items.length - 1]
}
