'use client'

// PRD section 43: the completed protection report.

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ErrorCard } from '@/components/error-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import { bpsPercent, duration, money, signedMoney, when } from '@/lib/format'
import { plainCloseReason } from '@/lib/plain'

export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>()
  const receipt = useQuery({ queryKey: ['receipt', id], queryFn: () => api.receipt(id), retry: false })

  if (receipt.isError) return <ErrorCard title="No receipt yet" message={(receipt.error as Error).message} />
  if (!receipt.data) return <Skeleton className="h-64 w-full" />
  const r = receipt.data.receipt
  const ticker = r.asset.replace(/\.US$/, '')

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Protection report</p>
        <h1 className="text-3xl font-semibold">
          {ticker} · {bpsPercent(r.protectionBps)} · {duration(r.durationSec)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {when(r.openedAt)} to {when(r.closedAt)} · cover {plainCloseReason(r.closeReason)}
        </p>
      </header>

      <Card>
        <CardContent className="pt-6">
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <Row label="Value at start" value={money(r.startingStockValue)} sub={`${r.stockQuantity} shares at ${money(r.startingStockPrice)}`} />
            <Row label="Value at end" value={money(r.endingStockValue)} sub={`at ${money(r.endingStockPrice)}`} />
            <Row label="Your shares moved" value={signedMoney(r.underlyingPnl)} />
            <Row label="Cover offset" value={signedMoney(r.hedgePnl)} sub={`cover of ${r.hedgeQuantity} shares, ${money(r.entryPrice)} to ${money(r.exitPrice)}`} />
            <Row label="Funding" value={signedMoney(r.funding)} />
            <Row label="Cost" value={signedMoney(-Number(r.fees))} />
            <Row label="Interest (whole account)" value={signedMoney(r.borrowInterest)} />
          </dl>
          <div className="mt-4 border-t pt-4">
            <dl className="grid grid-cols-2 gap-y-2">
              <Row label="Value with cover" value={money(r.netProtectedValue)} strong />
              <Row label="Change since start" value={signedMoney(r.trackingDifference)} strong />
            </dl>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Records</CardTitle>
          <CardDescription>The Backpack orders behind this cover and the Solana transactions that seal this report.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <ul className="flex flex-col gap-1">
            {r.orders.map((o, i) => (
              <li key={i} className="flex flex-wrap gap-x-3">
                <span>
                  {o.purpose === 'OPEN' ? 'cover set' : 'cover lifted'}: {o.quantity} at {money(o.avgPrice)} · fee {money(o.fee, true)}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{o.backpackOrderId}</span>
              </li>
            ))}
          </ul>
          <ul className="flex flex-col gap-1">
            {receipt.data.anchors.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3">
                <span className="font-medium">{a.kind}</span>
                <Badge variant="outline">{a.status}</Badge>
                <span className="font-mono text-xs text-muted-foreground">sha256 {a.digest.slice(0, 20)}…</span>
                {a.signature && (
                  <a className="underline" href={`https://explorer.solana.com/tx/${a.signature}`} target="_blank" rel="noreferrer">
                    view on Solana
                  </a>
                )}
              </li>
            ))}
            {receipt.data.anchors.length === 0 && <li className="text-muted-foreground">No Solana anchors were written (anchoring off or no SOL).</li>}
          </ul>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button nativeButton={false} render={<Link href={`/protection/${id}`} />} variant="outline">Back</Button>
        <Button nativeButton={false} render={<Link href="/" />}>Home</Button>
      </div>
    </div>
  )
}

function Row({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">
        {label}
        {sub && <span className="block text-xs">{sub}</span>}
      </dt>
      <dd className={`text-right tabular-nums ${strong ? 'text-lg font-semibold' : ''}`}>{value}</dd>
    </>
  )
}
