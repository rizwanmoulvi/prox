'use client'

// The portfolio: what the account holds, how much of it is hedged, and whether margin is healthy.

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { CoverageBar } from '@/components/coverage-bar'
import { ErrorCard } from '@/components/error-card'
import { Loader } from '@/components/loader'
import { MarginMeter } from '@/components/margin-meter'
import { SessionCard } from '@/components/session-card'
import { Button } from '@/components/ui/button'
import { LineRow } from '@/components/umbra'
import { api, type Plan, type PolicyWithLeg, type Portfolio } from '@/lib/api'
import { bpsPercent, money, percent, scheduleHours, STATUS_LABEL, when } from '@/lib/format'
import { shortQuantityFor } from '@/lib/hedge'

const LIVE = new Set(['OPENING', 'ACTIVE', 'PARTIAL', 'WAIT_REOPEN', 'WAIT_CONVERGENCE', 'REDUCING', 'EMERGENCY', 'EXPIRED', 'CLOSING'])

export default function PortfolioPage() {
  const portfolio = useQuery({ queryKey: ['portfolio'], queryFn: api.portfolio, refetchInterval: 15_000 })
  const policies = useQuery({ queryKey: ['policies'], queryFn: api.policies, refetchInterval: 15_000 })
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 30_000 })
  const plans = useQuery({ queryKey: ['plans'], queryFn: api.plans, refetchInterval: 15_000 })

  if (portfolio.isError) return <ErrorCard title="Could not read the Backpack account" message={(portfolio.error as Error).message} />
  if (!portfolio.data) return <Loader label="Reading the portfolio" />

  const account = portfolio.data.health
  const live = (policies.data ?? []).filter((p) => LIVE.has(p.policy.status))
  const activePlans = (plans.data ?? []).filter((p) => p.status === 'ACTIVE')
  const rows = portfolio.data.holdings.map((holding) => {
    const policy = live.find((p) => p.leg.stockSymbol === holding.symbol)
    const value = Number(holding.marketValue)
    const shortQuantity = shortQuantityFor(holding.symbol, portfolio.data.positions)
    // A short ProX opened is counted from its policy. Any other short on the perp still hedges
    // the stock, so it counts too, and is labelled as not managed here.
    const covered = policy ? value * (policy.policy.actualProtectionBps / 10_000) : Math.min(value, shortQuantity * Number(holding.markPrice))
    const plan = activePlans.find((p) => p.stockSymbols.includes(holding.symbol))
    return { holding, policy, plan, value, shortQuantity, covered }
  })
  const stockValue = rows.reduce((sum, r) => sum + r.value, 0)
  const usdc = portfolio.data.collateral.collateral.find((c) => c.symbol === 'USDC')
  // Market value of everything held. Backpack's own total weights each asset by how much it counts
  // as collateral, which would show the stocks at a fraction of their price.
  const portfolioValue = stockValue + portfolio.data.otherAssets.reduce((sum, a) => sum + Number(a.marketValue), 0)
  const covered = rows.reduce((sum, r) => sum + r.covered, 0)
  const unmanaged = rows.some((r) => !r.policy && r.shortQuantity > 0)

  return (
    <div className="grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-12">
        <section>
          <p className="text-sm text-ink-soft">Portfolio value</p>
          <p className="mt-1 font-heading text-[clamp(3.6rem,11vw,6rem)] leading-[0.95] font-medium tracking-[-1.5px]">{money(portfolioValue)}</p>
          <p className="mt-3 text-sm text-ink-soft">
            {money(stockValue)} in stocks, {money(usdc?.balanceNotional ?? 0)} in USDC, {money(account.netEquityAvailable)} of free margin
          </p>
          <div className="mt-7 max-w-xl">
            <CoverageBar covered={covered} total={stockValue} managed={live.length > 0} />
            {unmanaged && (
              <p className="mt-3 border-l-2 border-gold pl-3 text-sm leading-relaxed text-ink-soft">
                Backpack shows a short that ProX did not open. It hedges the stock, but ProX will not watch or close it.
              </p>
            )}
          </div>
        </section>

        <section>
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-heading text-[1.6rem] font-semibold tracking-[-0.3px]">Stocks</h2>
            {rows.length > 0 && (
              <Link href="/app/protect" className="text-sm font-bold text-gold-deep">
                Protect stocks
              </Link>
            )}
          </div>
          {rows.length === 0 && (
            <p className="mt-4 max-w-md leading-relaxed text-ink-soft">This Backpack account holds no tokenized stock. Buy one on Backpack and it will appear here, ready to protect.</p>
          )}
          <ul className="mt-2">
            {rows.map(({ holding, policy, plan, shortQuantity, covered: rowCovered, value }) => {
              const ticker = holding.symbol.replace(/\.US$/, '')
              return (
                <li key={holding.symbol} className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-line-soft py-5 last:border-b-0">
                  <span className="grid size-11 flex-none place-items-center rounded-full bg-paper-2 font-heading text-xl font-semibold shadow-[inset_0_0_0_1.5px_var(--line)]" aria-hidden>
                    {ticker[0]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[1.05rem] font-bold">{ticker}</p>
                    <p className="truncate text-sm text-ink-soft">{holding.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-[1.05rem]">{money(value)}</p>
                    <p className="text-sm text-ink-soft">
                      {holding.quantity} at {money(holding.markPrice)}
                    </p>
                  </div>
                  <div className="w-full text-sm sm:w-44 sm:text-right">
                    {policy ? (
                      <>
                        <p className="font-bold text-gold-deep">{bpsPercent(policy.policy.actualProtectionBps)} protected</p>
                        <p className="text-ink-soft">{STATUS_LABEL[policy.policy.status] ?? policy.policy.status}</p>
                      </>
                    ) : shortQuantity > 0 ? (
                      <>
                        <p className="font-bold">{Math.round((rowCovered / Math.max(value, 1e-9)) * 100)}% hedged</p>
                        <p className="text-ink-soft">Short {shortQuantity} on Backpack</p>
                      </>
                    ) : plan ? (
                      <>
                        <p className="font-bold">Scheduled</p>
                        <p className="text-ink-soft">{scheduleLine(plan)}</p>
                      </>
                    ) : (
                      <>
                        <p className="font-bold">Not protected</p>
                        <p className="text-ink-soft">{percent(holding.collateralWeight, 0)} counts as collateral</p>
                      </>
                    )}
                  </div>
                  {policy ? (
                    <Button nativeButton={false} render={<Link href={`/app/protection/${policy.policy.id}`} />} variant="secondary" className="rounded-full">
                      View
                    </Button>
                  ) : (
                    <Button nativeButton={false} render={<Link href={`/app/protect?symbol=${encodeURIComponent(holding.symbol)}`} />} className="rounded-full">
                      Protect
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        <UsdcBalance usdc={usdc} />
        <Schedules plans={plans.data ?? []} />
        <Protections policies={policies.data ?? []} />
      </div>

      <aside className="flex flex-col gap-10 lg:border-l lg:border-line lg:pl-10">
        {health.data && <SessionCard session={health.data.session} />}
        <section aria-label="Account health">
          <MarginMeter mmr={account.mmr} risk={account.risk} />
          <div className="mt-5">
            <LineRow label="Net equity" value={money(account.netEquity)} />
            <LineRow label="Free margin" value={money(account.netEquityAvailable)} />
            <LineRow label="Initial margin used" value={percent(account.imr)} />
            <LineRow label="Borrowed" value={money(account.borrowLiability)} />
            <LineRow label="Leverage limit" value={`${account.leverageLimit}x`} />
          </div>
        </section>
      </aside>
    </div>
  )
}

function Protections({ policies }: { policies: PolicyWithLeg[] }) {
  return (
    <section>
      <h2 className="font-heading text-[1.6rem] font-semibold tracking-[-0.3px]">Protections</h2>
      {policies.length === 0 ? (
        <p className="mt-4 max-w-md leading-relaxed text-ink-soft">None yet. Open one from a stock above and it will show here with its result.</p>
      ) : (
        <ul className="mt-2">
          {policies.slice(0, 8).map(({ policy, leg }) => (
            <li key={policy.id}>
              <Link
                href={policy.status === 'CLOSED' ? `/app/protection/${policy.id}/receipt` : `/app/protection/${policy.id}`}
                className="-mx-2 grid grid-cols-[auto_1fr_auto] items-center gap-x-4 rounded-md border-b border-line-soft px-2 py-3.5 text-ink no-underline transition-colors duration-150 hover:bg-ink/[0.04]"
              >
                <span className="font-bold">{leg.stockSymbol.replace(/\.US$/, '')}</span>
                <span className="text-sm text-ink-soft">
                  {bpsPercent(policy.actualProtectionBps || policy.requestedProtectionBps)} from {when(policy.startAt)}
                </span>
                <span className={`text-sm font-bold ${LIVE.has(policy.status) ? 'text-gold-deep' : policy.status === 'FAILED' ? 'text-danger' : 'text-ink-soft'}`}>
                  {STATUS_LABEL[policy.status] ?? policy.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Schedules({ plans }: { plans: Plan[] }) {
  if (!plans.length) return null
  return (
    <section>
      <h2 className="font-heading text-[1.6rem] font-semibold tracking-[-0.3px]">Schedules</h2>
      <ul className="mt-2">
        {plans.slice(0, 6).map((plan) => (
          <li key={plan.id}>
            <Link
              href={`/app/plans/${plan.id}`}
              className="-mx-2 grid grid-cols-[auto_1fr_auto] items-center gap-x-4 rounded-md border-b border-line-soft px-2 py-3.5 text-ink no-underline transition-colors duration-150 hover:bg-ink/[0.04]"
            >
              <span className="font-bold">{plan.stockSymbols.map((s) => s.replace(/\.US$/, '')).join(', ')}</span>
              <span className="text-sm text-ink-soft">
                {bpsPercent(plan.protectionBps)}, {scheduleLine(plan)}
              </span>
              <span className={`text-sm font-bold ${plan.status === 'ACTIVE' ? 'text-gold-deep' : 'text-ink-soft'}`}>
                {plan.status === 'ACTIVE' ? 'Running' : plan.status === 'CANCELLED' ? 'Stopped' : 'Finished'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function scheduleLine(plan: Plan): string {
  const hours = plan.windowKind === 'CUSTOM' ? scheduleHours(plan) : scheduleHours(plan).toLowerCase()
  return `${hours}, ${plan.days === 1 ? 'once' : `${plan.days} days`}`
}

type CollateralRow = Portfolio['collateral']['collateral'][number]

function UsdcBalance({ usdc }: { usdc: CollateralRow | undefined }) {
  const total = Number(usdc?.totalQuantity ?? 0)
  const available = Number(usdc?.availableQuantity ?? 0)
  const onOrders = Number(usdc?.openOrderQuantity ?? 0)
  const lent = Number(usdc?.lendQuantity ?? 0)
  const parts = [available !== total && `${available} available`, onOrders > 0 && `${onOrders} on orders`, lent > 0 && `${lent} lent`].filter(Boolean)
  return (
    <section>
      <h2 className="font-heading text-[1.6rem] font-semibold tracking-[-0.3px]">Balance</h2>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-line-soft py-5">
        <span className="grid size-11 flex-none place-items-center rounded-full bg-paper-2 font-heading text-xl font-semibold shadow-[inset_0_0_0_1.5px_var(--line)]" aria-hidden>
          $
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[1.05rem] font-bold">USDC</p>
          <p className="text-sm text-ink-soft">Pays each hedge&apos;s fees and settles what the hedge gains or loses</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[1.05rem]">{money(usdc?.balanceNotional ?? 0)}</p>
          <p className="text-sm text-ink-soft">
            {usdc ? `${usdc.totalQuantity} USDC` : 'No USDC'}
            {parts.length ? `, ${parts.join(', ')}` : usdc ? ', all available' : ''}
          </p>
        </div>
      </div>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-soft">
        If it runs out, Backpack borrows USDC against your stocks to settle, and converts stock only as a last resort.
      </p>
    </section>
  )
}
