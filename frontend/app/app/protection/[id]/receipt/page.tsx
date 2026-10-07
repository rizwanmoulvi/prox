'use client'

// The finished protection: what it saved, what it cost, and the proof.

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Anchors } from '@/components/anchors-list'
import { ErrorCard } from '@/components/error-card'
import { Loader } from '@/components/loader'
import { ResultEquation } from '@/components/result-equation'
import { Button } from '@/components/ui/button'
import { LineRow } from '@/components/umbra'
import { api } from '@/lib/api'
import { bpsPercent, duration, money, signedMoney, when } from '@/lib/format'

const REASON: Record<string, string> = {
  CONVERGED: 'The market reopened and prices agreed.',
  MANUAL: 'It was closed by hand.',
  EMERGENCY: 'Margin ran tight, so ProX closed it early.',
  EXPIRED: 'The window ran out before prices agreed.',
}

export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>()
  const receipt = useQuery({ queryKey: ['receipt', id], queryFn: () => api.receipt(id), retry: false })

  if (receipt.isError) return <ErrorCard title="No receipt yet" message={`${(receipt.error as Error).message}. A receipt is written when the hedge has closed.`} />
  if (!receipt.data) return <Loader label="Building the receipt" />
  const r = receipt.data.receipt
  const ticker = r.asset.replace(/\.US$/, '')
  const stock = Number(r.underlyingPnl)
  const hedge = Number(r.hedgePnl)
  const costs = Number(r.fees) - Number(r.funding) - Number(r.borrowInterest)
  const withoutHedge = Number(r.endingStockValue)
  const kept = Number(r.netProtectedValue)

  return (
    <div className="mx-auto flex max-w-[880px] flex-col gap-12">
      <header>
        <Link href={`/app/protection/${id}`} className="text-sm text-ink-soft">
          Back to the protection
        </Link>
        <h1 className="mt-2 font-heading text-[clamp(2.2rem,6vw,3.4rem)] leading-[1.02] font-semibold tracking-[-0.6px]">
          {ticker} was protected for {duration(r.durationSec)}
        </h1>
        <p className="mt-3 max-w-[60ch] leading-relaxed text-ink-soft">
          {bpsPercent(r.protectionBps)} of the position, from {when(r.openedAt)} to {when(r.closedAt)}. {REASON[r.closeReason] ?? ''}
        </p>
      </header>

      <ResultEquation stock={stock} hedge={hedge} costs={costs} net={stock + hedge - costs} />

      <section className="grid gap-x-12 gap-y-6 border-y border-line py-8 sm:grid-cols-2">
        <div>
          <p className="text-sm text-ink-soft">You hold</p>
          <p className="mt-1 font-heading text-[2.6rem] leading-none font-medium tracking-[-0.6px]">{money(kept)}</p>
          <p className="mt-2 text-sm text-ink-soft">Stock plus what the hedge earned, after costs</p>
        </div>
        <div>
          <p className="text-sm text-ink-soft">Without the hedge</p>
          <p className="mt-1 font-heading text-[2.6rem] leading-none font-medium tracking-[-0.6px] text-ink-soft">{money(withoutHedge)}</p>
          <p className="mt-2 text-sm text-ink-soft">
            {kept >= withoutHedge ? `The hedge kept ${money(kept - withoutHedge, true)} for you.` : `The stock rose, and the hedge gave up ${money(withoutHedge - kept, true)} of that.`}
          </p>
        </div>
      </section>

      <section>
        <h2 className="font-heading text-[1.6rem] font-semibold tracking-[-0.3px]">Statement</h2>
        <div className="mt-3">
          <LineRow label="Stock at the start" sub={`${r.stockQuantity} shares at ${money(r.startingStockPrice)}`} value={money(r.startingStockValue)} />
          <LineRow label="Stock at the end" sub={`at ${money(r.endingStockPrice)}`} value={money(r.endingStockValue)} />
          <LineRow label="Change in the stock" value={signedMoney(r.underlyingPnl)} />
          <LineRow label="Hedge" sub={`Short ${r.hedgeQuantity}, sold at ${money(r.entryPrice)}, bought back at ${money(r.exitPrice)}`} value={signedMoney(r.hedgePnl)} />
          <LineRow label="Funding" value={signedMoney(r.funding)} />
          <LineRow label="Trading fees" value={signedMoney(-Number(r.fees))} />
          <LineRow label="Borrow interest" sub="For the whole account; Backpack does not split it by position" value={signedMoney(-Number(r.borrowInterest))} />
          <LineRow label="Difference from a perfect hedge" value={signedMoney(r.trackingDifference)} />
        </div>
      </section>

      <section>
        <h2 className="font-heading text-[1.6rem] font-semibold tracking-[-0.3px]">Proof</h2>
        <p className="mt-2 mb-3 max-w-[60ch] text-sm leading-relaxed text-ink-soft">The orders as Backpack recorded them, and the hashes written to Solana. Anyone with this receipt can recompute a hash and compare.</p>
        <ol>
          {r.orders.map((o, i) => (
            <li key={i} className="grid gap-x-6 gap-y-0.5 border-b border-line-soft py-3 sm:grid-cols-[14rem_1fr_auto]">
              <span className="font-bold">
                {o.purpose === 'OPEN' ? 'Open' : o.purpose === 'REDUCE' ? 'Reduce' : 'Close'}: {o.side === 'Ask' ? 'sold' : 'bought'} {o.quantity}
              </span>
              <span className="text-sm text-ink-soft">
                at {money(o.avgPrice)}, fee {money(o.fee, true)}
              </span>
              <span className="font-mono text-[0.8rem] break-all text-ink-faint">{o.backpackOrderId}</span>
            </li>
          ))}
        </ol>
        <div className="mt-6">
          <Anchors detail={{ anchors: receipt.data.anchors }} />
        </div>
      </section>

      <div className="flex flex-wrap gap-2.5">
        <Button nativeButton={false} render={<Link href="/app" />}>
          Back to the portfolio
        </Button>
        <Button nativeButton={false} render={<Link href={`/app/protect?symbol=${encodeURIComponent(r.asset)}`} />} variant="secondary">
          Protect {ticker} again
        </Button>
      </div>
    </div>
  )
}
