'use client'

// Three choices on the left (which stock, how much, how long) and what they amount to on the
// right, worked out by the backend from the live account.

import { useMutation, useQuery } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ErrorCard } from '@/components/error-card'
import { Loader } from '@/components/loader'
import { RiskBadge } from '@/components/risk-badge'
import { ScenarioTable } from '@/components/scenario-table'
import { Button } from '@/components/ui/button'
import { LineRow } from '@/components/umbra'
import { WindowTrack } from '@/components/window-track'
import { api, ApiError, type MarketRow, type Preview, type ProtectRequest } from '@/lib/api'
import { basis, bpsPercent, money, percent } from '@/lib/format'

const PRESETS = [2500, 5000, 7500, 10_000]
// What the user picks. "4 hours" is a custom window that ends four hours after it was chosen.
type Range = 'AFTER_HOURS' | 'FOUR_HOURS' | 'WEEKEND' | 'CUSTOM'
const RANGES: { value: Range; label: string; hint: string }[] = [
  { value: 'AFTER_HOURS', label: 'After hours', hint: 'Until the market opens' },
  { value: 'FOUR_HOURS', label: '4 hours', hint: 'Starting now' },
  { value: 'WEEKEND', label: 'Weekend', hint: 'Until Monday’s open' },
  { value: 'CUSTOM', label: 'Custom', hint: 'Until a time you set' },
]
const DAYS = [1, 3, 5] as const
const fourHoursFromNow = () => new Date(Date.now() + 4 * 3_600_000).toISOString()

export default function ProtectPage() {
  return (
    <Suspense fallback={<Loader />}>
      <ProtectForm />
    </Suspense>
  )
}

function ProtectForm() {
  const router = useRouter()
  const params = useSearchParams()
  const markets = useQuery({ queryKey: ['markets'], queryFn: api.markets, refetchInterval: 30_000 })
  const [symbol, setSymbol] = useState<string | null>(params.get('symbol'))
  const [bps, setBps] = useState(10_000)
  const [range, setRange] = useState<Range>('AFTER_HOURS')
  const [days, setDays] = useState<(typeof DAYS)[number]>(1)
  const [customEndAt, setCustomEndAt] = useState('')
  // Fixed when "4 hours" is picked, so the preview does not drift while the user reads it.
  const [fourHourEnd, setFourHourEnd] = useState<string | null>(null)
  const pickRange = (value: Range) => {
    setRange(value)
    if (value === 'FOUR_HOURS') setFourHourEnd(fourHoursFromNow())
  }

  const rows = markets.data ?? []
  const selected = rows.find((r) => r.symbol === symbol) ?? rows.find((r) => r.eligible) ?? rows[0]

  const request = useMemo<ProtectRequest | null>(() => {
    if (!selected) return null
    const base = { stockSymbol: selected.symbol, protectionBps: bps }
    if (range === 'AFTER_HOURS') return { ...base, mode: 'TONIGHT', days }
    if (range === 'WEEKEND') return { ...base, mode: 'WEEKEND' }
    if (range === 'FOUR_HOURS') return fourHourEnd ? { ...base, mode: 'CUSTOM', customEndAt: fourHourEnd } : null
    return customEndAt ? { ...base, mode: 'CUSTOM', customEndAt: new Date(customEndAt).toISOString() } : null
  }, [selected, bps, range, days, fourHourEnd, customEndAt])

  const preview = useQuery({
    queryKey: ['preview', request],
    queryFn: () => api.preview(request!),
    enabled: !!request,
    refetchInterval: 10_000,
    retry: false,
    // Keep the last figures on screen while a new choice loads, so the panel does not blink.
    placeholderData: (previous) => previous,
  })

  const activate = useMutation({
    mutationFn: () => api.activate(request!),
    onSuccess: (created) => {
      if (created.policy.status === 'FAILED') toast.error('The hedge did not fill')
      else toast.success('Protection activated')
      router.push(`/app/protection/${created.policy.id}`)
    },
    onError: (error) => toast.error(error instanceof ApiError ? [error.message, ...error.blockers].join(' ') : (error as Error).message),
  })

  if (markets.isError) return <ErrorCard title="Could not load the stocks you can protect" message={(markets.error as Error).message} />
  if (!markets.data) return <Loader label="Finding stocks you can protect" />
  if (!selected) return <ErrorCard title="Nothing to protect yet" message="This Backpack account holds no tokenized stock. Buy one on Backpack, then come back." />

  const blocked = preview.error instanceof ApiError ? preview.error : null
  const unavailable = selected.presets.filter((p) => !p.available)

  return (
    <div className="grid items-start gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
      <div className="flex flex-col gap-11">
        <header>
          <h1 className="font-heading text-[clamp(2.2rem,6vw,3.2rem)] leading-[1.02] font-semibold tracking-[-0.6px]">Protect a stock</h1>
          <p className="mt-3 max-w-[52ch] leading-relaxed text-ink-soft">
            You keep the stock. ProX opens a short against it for the hours you choose, so a fall in the price is offset.
          </p>
        </header>

        <Step number={1} title="Which stock" hint="Stocks this account holds that have a Backpack perpetual.">
          <div className="flex flex-wrap gap-2.5">
            {rows.map((row) => (
              <StockOption key={row.symbol} row={row} selected={row.symbol === selected.symbol} onSelect={() => setSymbol(row.symbol)} />
            ))}
          </div>
        </Step>

        <Step number={2} title="How much of it" hint="The share of the position the hedge offsets.">
          <div className="grid grid-cols-4 gap-2.5">
            {PRESETS.map((value) => {
              const preset = selected.presets.find((p) => p.bps === value)
              return (
                <Choice key={value} selected={bps === value} disabled={!preset?.available} onSelect={() => setBps(value)} title={preset?.available ? undefined : presetReason(preset?.reason, selected)}>
                  <span className="font-heading text-[1.5rem] leading-none font-medium">{bpsPercent(value)}</span>
                </Choice>
              )
            })}
          </div>
          {unavailable.length > 0 && (
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              {unavailable.map((p) => bpsPercent(p.bps)).join(', ')} {unavailable.length === 1 ? 'is' : 'are'} not possible for {selected.quantity} shares. The perp trades in steps of {selected.stepSize}, with a
              minimum of {selected.minQuantity}.
            </p>
          )}
        </Step>

        <Step number={3} title="For how long" hint="When the window ends, the hedge closes once the perp and the cash price agree.">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {RANGES.map((r) => (
              <Choice key={r.value} selected={range === r.value} onSelect={() => pickRange(r.value)} align="start">
                <span className="font-bold">{r.label}</span>
                <span className="text-[0.8rem] font-normal opacity-75">{r.hint}</span>
              </Choice>
            ))}
          </div>
          {range === 'AFTER_HOURS' && (
            <fieldset className="mt-5">
              <legend className="text-sm text-ink-soft">Keep it on for</legend>
              <div className="mt-2 grid max-w-sm grid-cols-3 gap-2.5">
                {DAYS.map((d) => (
                  <Choice key={d} selected={days === d} onSelect={() => setDays(d)}>
                    <span className="font-bold">{d === 1 ? '1 day' : `${d} days`}</span>
                  </Choice>
                ))}
              </div>
              <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                {days === 1 ? 'The hedge comes off after the next market open.' : `One hedge, held through ${days} market opens, then closed after the last.`}
              </p>
            </fieldset>
          )}
          {range === 'CUSTOM' && (
            <label className="mt-5 flex max-w-sm flex-col gap-2 text-sm text-ink-soft">
              Protect until
              <input
                type="datetime-local"
                value={customEndAt}
                onChange={(e) => setCustomEndAt(e.target.value)}
                className="rounded-lg bg-paper-2 px-[15px] py-[13px] text-base text-ink shadow-[inset_0_0_0_1.5px_var(--line)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--ink)]"
              />
            </label>
          )}
        </Step>
      </div>

      <Summary
        preview={preview.data}
        fetching={preview.isFetching}
        waitingForChoice={!request}
        blocked={blocked}
        onActivate={() => activate.mutate()}
        activating={activate.isPending}
      />
    </div>
  )
}

function Step({ number, title, hint, children }: { number: number; title: string; hint: string; children: ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-4">
        <span className="grid size-9 flex-none place-items-center rounded-full font-heading text-lg font-semibold shadow-[inset_0_0_0_1.5px_var(--ink)]" aria-hidden>
          {number}
        </span>
        <h2 className="font-heading text-[1.5rem] leading-9 font-semibold tracking-[-0.3px]">{title}</h2>
      </div>
      <div className="mt-1 sm:pl-[3.25rem]">
        <p className="mb-4 text-sm text-ink-soft">{hint}</p>
        {children}
      </div>
    </section>
  )
}

function Choice({ selected, disabled, onSelect, title, align = 'center', children }: { selected: boolean; disabled?: boolean; onSelect: () => void; title?: string; align?: 'center' | 'start'; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      title={title}
      onClick={onSelect}
      className={`flex min-h-[3.25rem] cursor-pointer flex-col justify-center gap-0.5 rounded-lg px-4 py-3 transition-[scale,background-color,color,box-shadow] duration-150 ease-out-strong active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-35 ${
        align === 'start' ? 'items-start text-left' : 'items-center text-center'
      } ${selected ? 'bg-ink text-paper' : 'text-ink shadow-[inset_0_0_0_1.5px_var(--line)] hover:shadow-[inset_0_0_0_1.5px_var(--ink)]'}`}
    >
      {children}
    </button>
  )
}

function StockOption({ row, selected, onSelect }: { row: MarketRow; selected: boolean; onSelect: () => void }) {
  return (
    <Choice selected={selected} onSelect={onSelect} align="start">
      <span className="font-heading text-[1.35rem] leading-tight font-semibold">{row.symbol.replace(/\.US$/, '')}</span>
      <span className="text-[0.8rem] font-normal opacity-75">
        {row.quantity} shares, {money(row.marketValue)}
      </span>
      {!row.eligible && <span className={`mt-1 text-[0.8rem] font-normal ${selected ? 'text-paper' : 'text-danger'}`}>{row.reasons.join(', ')}</span>}
    </Choice>
  )
}

function presetReason(reason: string | null | undefined, row: MarketRow): string {
  if (reason === 'BELOW_MINIMUM') return `Below the perp minimum of ${row.minQuantity}`
  if (reason === 'OFF_GRID') return `The perp trades in steps of ${row.stepSize}`
  return reason ?? 'Unavailable'
}

function Summary({ preview, fetching, waitingForChoice, blocked, onActivate, activating }: { preview: Preview | undefined; fetching: boolean; waitingForChoice: boolean; blocked: ApiError | null; onActivate: () => void; activating: boolean }) {
  const frame = 'rounded-xl bg-paper-2 p-6 shadow-[inset_0_0_0_1.5px_var(--line)] lg:sticky lg:top-6'
  if (blocked) {
    return (
      <aside className={frame}>
        <h2 className="font-heading text-[1.5rem] font-semibold tracking-[-0.3px]">This stock cannot be protected now</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 leading-relaxed text-ink-soft">
          {(blocked.blockers.length ? blocked.blockers : [blocked.message]).map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </aside>
    )
  }
  if (!preview) {
    return (
      <aside className={frame}>
        {waitingForChoice ? <p className="leading-relaxed text-ink-soft">Set an end time to see what this protection would do.</p> : <Loader compact label="Reading the account and the order book" />}
      </aside>
    )
  }

  const ticker = preview.stockSymbol.replace(/\.US$/, '')
  const stockValue = Number(preview.stockValue)
  const hedgeNotional = Number(preview.targetNotional)
  const nothingToOpen = Number(preview.orderQuantity) <= 0
  const canActivate = preview.canActivate && !nothingToOpen
  const perpName = preview.perpSymbol.replace(/(\.US)?_USDC_PERP$/, '')

  return (
    <aside className={frame} aria-busy={fetching}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-heading text-[2.2rem] leading-none font-semibold tracking-[-0.5px]">{ticker}</h2>
        <span className="font-mono text-sm text-ink-soft">{money(preview.stockMarkPrice)} a share</span>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-4">
        <div>
          <dt className="text-sm text-ink-soft">Protected</dt>
          <dd className="font-heading text-[2.4rem] leading-tight font-medium tracking-[-0.6px]">{money(hedgeNotional)}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-soft">Still exposed</dt>
          <dd className="font-heading text-[2.4rem] leading-tight font-medium tracking-[-0.6px] text-ink-soft">{money(Math.max(0, Number(preview.netExposureAfter)))}</dd>
        </div>
      </dl>

      <div className="mt-6 border-t border-line pt-5">
        <WindowTrack endsAt={preview.reopenAt} hardStopAt={preview.maxEndAt} />
      </div>

      <div className="mt-6 border-t border-line pt-5">
        <ScenarioTable ticker={ticker} stockValue={stockValue} hedgeNotional={hedgeNotional} />
        <p className="mt-2 text-[0.8rem] leading-relaxed text-ink-faint">Before costs. The round trip costs about {money(preview.costs.tradingFeeRoundTrip, true)} in fees, plus funding while the short is open.</p>
      </div>

      <details className="group mt-5 border-t border-line pt-4">
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-bold text-ink-soft [&::-webkit-details-marker]:hidden">
          How the hedge is built
          <span className="font-mono text-ink-faint transition-transform duration-150 ease-out-strong group-open:rotate-45" aria-hidden>
            +
          </span>
        </summary>
        <div className="mt-2">
          <LineRow label="Order" value={nothingToOpen ? 'None needed' : `Short ${preview.orderQuantity} ${perpName} perp`} />
          {Number(preview.existingShortQuantity) > 0 && <LineRow label="Short already open" value={`${preview.existingShortQuantity} ${perpName}`} />}
          <LineRow label="Leverage" value={preview.leverage ? `${preview.leverage}x` : 'n/a'} />
          <LineRow label="Risk after opening" value={preview.projectedRisk ? <RiskBadge state={preview.projectedRisk} /> : 'n/a'} />
          <LineRow label="Margin used after" value={percent(preview.projectedMmr)} />
          <LineRow label="Free margin now" value={money(preview.account.netEquityAvailable)} />
          <LineRow label="Counts as collateral" value={money(preview.collateralValue)} />
          <LineRow label="Perp price, index" value={`${money(preview.perpMarkPrice)}, ${money(preview.perpIndexPrice)}`} />
          <LineRow label="Gap between perp and stock" value={basis(((Number(preview.perpMarkPrice) - Number(preview.stockMarkPrice)) / Number(preview.stockMarkPrice)) * 10_000)} />
          <LineRow label="Funding each hour" value={preview.costs.fundingRateHourly ? `${(Number(preview.costs.fundingRateHourly) * 100).toFixed(4)}%, changes` : 'changes'} />
        </div>
      </details>

      {nothingToOpen && (
        <p className="mt-5 border-l-2 border-gold pl-3 leading-relaxed text-ink-soft">
          The account already holds a short of {preview.existingShortQuantity} {perpName}, which covers this level. There is nothing for ProX to open.
        </p>
      )}
      {preview.safeProtectionBps < preview.requestedProtectionBps && (
        <p className="mt-5 border-l-2 border-gold pl-3 leading-relaxed text-ink-soft">
          Backpack allows {bpsPercent(preview.safeProtectionBps)} at most right now, an order of {preview.maxOrderQuantity}.
        </p>
      )}
      {preview.blockers.length > 0 && (
        <ul className="mt-5 space-y-1 border-l-2 border-danger pl-3 leading-relaxed text-danger">
          {preview.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}

      <Button size="lg" className="mt-6 w-full" disabled={!canActivate || activating} onClick={onActivate}>
        {activating ? 'Placing the hedge' : nothingToOpen ? 'Already covered' : `Protect ${money(hedgeNotional)} of ${ticker}`}
      </Button>
      {canActivate && (
        <p className="mt-3 text-[0.8rem] leading-relaxed text-ink-faint">
          This places a real order on Backpack: sell {preview.orderQuantity} {perpName} perp at {money(preview.orderLimitPrice)} or better, filled at once or not at all.
        </p>
      )}
    </aside>
  )
}
