'use client'

// The choices on the left (which stocks, how much, when, for how many days) and what they amount
// to on the right, worked out by the backend from the live account. Weekend cover is one hedge
// held until Monday's open; every other choice becomes a schedule the backend runs on its own.

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
import { api, ApiError, type GroupPreview, type MarketRow, type PlanPreview, type PlanRequest, type Preview } from '@/lib/api'
import { bpsPercent, clock, dateOnly, dayLabel, localToNy, money, myZone, nyTime, nyWallClock, percent, zoneLabel } from '@/lib/format'

const PRESETS = [2500, 5000, 7500, 10_000]
type When = 'OVERNIGHT' | 'POST_MARKET' | 'PRE_MARKET' | 'WEEKEND' | 'CUSTOM'
// The market sessions are fixed in New York. Each choice shows them on the viewer's own clock
// first, with New York underneath for reference.
const WHENS: { value: When; label: string; yours: () => string; ny: string }[] = [
  { value: 'OVERNIGHT', label: 'Overnight', yours: () => yourRange('20:00', '04:00', 1), ny: '8 PM to 4 AM in New York' },
  { value: 'POST_MARKET', label: 'After hours', yours: () => yourRange('16:00', '20:00', 0), ny: '4 PM to 8 PM in New York' },
  { value: 'PRE_MARKET', label: 'Pre-market', yours: () => yourRange('04:00', '09:30', 0), ny: '4 AM to 9:30 AM in New York' },
  { value: 'WEEKEND', label: 'Weekend', yours: () => `Until Monday ${clock(nyWallClock('09:30'))}`, ny: 'Friday close to Monday open' },
  { value: 'CUSTOM', label: 'Custom', yours: () => 'Any hours you choose', ny: 'Set in your own time' },
]

function yourRange(nyStart: string, nyEnd: string, endDaysAhead: number): string {
  return `${clock(nyWallClock(nyStart))} to ${clock(nyWallClock(nyEnd, endDaysAhead))}`
}

/** "HH:00" on the viewer's clock, `hours` from now. */
function hourFromNow(hours: number): string {
  const at = new Date(Date.now() + hours * 3_600_000)
  return `${String(at.getHours()).padStart(2, '0')}:00`
}

const IN_NEW_YORK = () => myZone() === 'America/New_York'
const DAYS = [1, 5, 14, 30]
type WeekendPreview = { symbol: string; preview: Preview } | { symbol: string; error: ApiError }

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
  // Null until the user touches the list: then every stock that can be covered is selected.
  const [picked, setPicked] = useState<string[] | null>(() => {
    const fromUrl = [...(params.get('symbols') ?? '').split(','), params.get('symbol') ?? ''].filter(Boolean)
    return fromUrl.length ? fromUrl : null
  })
  const [bps, setBps] = useState(10_000)
  const [when, setWhen] = useState<When>('OVERNIGHT')
  const [days, setDays] = useState(1)
  const [customStart, setCustomStart] = useState(() => hourFromNow(1))
  const [customEnd, setCustomEnd] = useState(() => hourFromNow(2))

  const rows = useMemo(() => markets.data ?? [], [markets.data])
  const coverable = useMemo(() => rows.filter((r) => r.eligible && r.presets.find((p) => p.bps === bps)?.available).map((r) => r.symbol), [rows, bps])
  const selected = useMemo(() => (picked ?? coverable).filter((s) => coverable.includes(s)), [picked, coverable])
  const toggle = (symbol: string) => setPicked(selected.includes(symbol) ? selected.filter((s) => s !== symbol) : [...selected, symbol])

  const planRequest = useMemo<PlanRequest | null>(() => {
    if (!selected.length || when === 'WEEKEND') return null
    const window = when === 'CUSTOM' ? { kind: 'CUSTOM' as const, customStart, customEnd, timeZone: myZone() } : { kind: when }
    return { stockSymbols: selected, protectionBps: bps, window, days }
  }, [selected, bps, when, customStart, customEnd, days])

  const plan = useQuery({
    queryKey: ['plan-preview', planRequest],
    queryFn: () => api.planPreview(planRequest!),
    enabled: !!planRequest,
    refetchInterval: 15_000,
    retry: false,
    placeholderData: (previous) => previous,
  })
  const weekend = useQuery({
    queryKey: ['weekend-preview', selected, bps],
    queryFn: (): Promise<WeekendPreview[]> =>
      Promise.all(
        selected.map((symbol) =>
          api
            .preview({ stockSymbol: symbol, protectionBps: bps, mode: 'WEEKEND' })
            .then((preview) => ({ symbol, preview }))
            .catch((error: ApiError) => ({ symbol, error })),
        ),
      ),
    enabled: when === 'WEEKEND' && selected.length > 0,
    refetchInterval: 15_000,
    retry: false,
    placeholderData: (previous) => previous,
  })
  // Stocks hedged together share the account's margin, so the backend checks them as one group.
  const group = useQuery({
    queryKey: ['group-preview', selected, bps],
    queryFn: () => api.groupPreview({ stockSymbols: selected, protectionBps: bps, mode: 'WEEKEND' }),
    enabled: when === 'WEEKEND' && selected.length > 1,
    refetchInterval: 15_000,
    retry: false,
    placeholderData: (previous) => previous,
  })

  const protect = useMutation({
    mutationFn: async () => {
      if (when !== 'WEEKEND') return { planId: (await api.createPlan(planRequest!)).plan.id }
      const results = Object.entries(await api.activateGroup({ stockSymbols: selected, protectionBps: bps, mode: 'WEEKEND' }))
      const failed = results.filter(([, r]) => r.error)
      if (failed.length) toast.error(`${failed.map(([symbol]) => ticker(symbol)).join(', ')} could not be hedged: ${failed[0]![1].error}`)
      return { policyIds: results.filter(([, r]) => r.policyId && !r.error).map(([, r]) => r.policyId!) }
    },
    onSuccess: (result) => {
      if ('planId' in result) {
        toast.success('Protection scheduled')
        router.push(`/app/plans/${result.planId}`)
        return
      }
      if (result.policyIds.length) toast.success('Weekend protection is on')
      router.push(result.policyIds.length === 1 ? `/app/protection/${result.policyIds[0]}` : '/app')
    },
    onError: (error) => toast.error(error instanceof ApiError ? [error.message, ...error.blockers].join(' ') : (error as Error).message),
  })

  if (markets.isError) return <ErrorCard title="Could not load the stocks you can protect" message={(markets.error as Error).message} />
  if (!markets.data) return <Loader label="Finding stocks you can protect" />
  if (!rows.length) return <ErrorCard title="Nothing to protect yet" message="This Backpack account holds no tokenized stock. Buy one on Backpack, then come back." />

  const choose = (value: When) => {
    setWhen(value)
    if (value === 'WEEKEND') setDays(1)
  }

  return (
    <div className="grid items-start gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
      <div className="flex flex-col gap-11">
        <header>
          <h1 className="font-heading text-[clamp(2.2rem,6vw,3.2rem)] leading-[1.02] font-semibold tracking-[-0.6px]">Protect your stocks</h1>
          <p className="mt-3 max-w-[52ch] leading-relaxed text-ink-soft">
            You keep the stocks. For the hours you choose, ProX holds a short against each of them, so a fall in the price is offset. Pick one stock or all of them; it is one click either way.
          </p>
        </header>

        <Step number={1} title="Which stocks" hint="Stocks this account holds that have a Backpack perpetual.">
          <div className="flex flex-wrap gap-2.5">
            {rows.map((row) => (
              <StockOption key={row.symbol} row={row} bps={bps} selected={selected.includes(row.symbol)} onSelect={() => toggle(row.symbol)} />
            ))}
          </div>
          {coverable.length > 1 && (
            <div className="mt-3 flex gap-4 text-sm">
              <button type="button" className="cursor-pointer font-bold text-gold-deep" onClick={() => setPicked(coverable)}>
                Select all
              </button>
              <button type="button" className="cursor-pointer text-ink-soft" onClick={() => setPicked([])}>
                Clear
              </button>
            </div>
          )}
        </Step>

        <Step number={2} title="How much of each" hint="The share of each position the hedge offsets.">
          <div className="grid grid-cols-4 gap-2.5">
            {PRESETS.map((value) => (
              <Choice key={value} selected={bps === value} onSelect={() => setBps(value)}>
                <span className="font-heading text-[1.5rem] leading-none font-medium">{bpsPercent(value)}</span>
              </Choice>
            ))}
          </div>
        </Step>

        <Step number={3} title="When" hint={`The hours each day while the hedge is on, shown in your own time, ${zoneLabel()}.`}>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {WHENS.map((w) => (
              <Choice key={w.value} selected={when === w.value} onSelect={() => choose(w.value)} align="start">
                <span className="font-bold">{w.label}</span>
                <span className="text-[0.8rem] font-normal opacity-80">{w.yours()}</span>
                {!IN_NEW_YORK() && <span className="text-[0.72rem] font-normal opacity-55">{w.ny}</span>}
              </Choice>
            ))}
          </div>
          {when === 'CUSTOM' && (
            <div className="mt-5 max-w-sm">
              <div className="grid grid-cols-2 gap-3">
                <TimeField label="From" value={customStart} onChange={setCustomStart} />
                <TimeField label="To" value={customEnd} onChange={setCustomEnd} />
              </div>
              <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                In your own time, {zoneLabel()}.{' '}
                {!IN_NEW_YORK() && customStart && customEnd && `In New York that is ${localToNy(customStart)} to ${localToNy(customEnd)}.`}
              </p>
            </div>
          )}
        </Step>

        {when !== 'WEEKEND' && (
          <Step number={4} title="For how many days" hint="The hedge opens at the start of the hours and closes at the end, each day. Days the market is shut are skipped.">
            <div className="flex flex-wrap gap-2.5">
              {DAYS.map((d) => (
                <Choice key={d} selected={days === d} onSelect={() => setDays(d)}>
                  <span className="font-bold">{d === 1 ? 'Once' : `${d} days`}</span>
                </Choice>
              ))}
              <label className="flex items-center gap-2 rounded-lg px-4 text-sm text-ink-soft shadow-[inset_0_0_0_1.5px_var(--line)]">
                <input
                  type="number"
                  min={1}
                  max={60}
                  aria-label="Number of days"
                  value={DAYS.includes(days) ? '' : days}
                  placeholder="Other"
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (n >= 1) setDays(Math.min(60, Math.floor(n)))
                  }}
                  className="w-16 bg-transparent py-3 text-base text-ink outline-none"
                />
                days
              </label>
            </div>
          </Step>
        )}
      </div>

      {when === 'WEEKEND' ? (
        <WeekendSummary
          rows={rows}
          selected={selected}
          previews={weekend.data}
          group={selected.length > 1 ? group.data : null}
          groupError={selected.length > 1 && group.error instanceof ApiError ? group.error : null}
          fetching={weekend.isFetching || group.isFetching}
          onProtect={() => protect.mutate()}
          protecting={protect.isPending}
        />
      ) : (
        <PlanSummary
          rows={rows}
          selected={selected}
          when={when}
          days={days}
          preview={plan.data}
          fetching={plan.isFetching}
          error={plan.error instanceof ApiError ? plan.error : null}
          onProtect={() => protect.mutate()}
          protecting={protect.isPending}
        />
      )}
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

function StockOption({ row, bps, selected, onSelect }: { row: MarketRow; bps: number; selected: boolean; onSelect: () => void }) {
  const preset = row.presets.find((p) => p.bps === bps)
  const why = !row.eligible ? row.reasons.join(', ') : !preset?.available ? presetReason(preset?.reason, row) : null
  return (
    <Choice selected={selected} disabled={!!why} onSelect={onSelect} align="start" title={why ?? undefined}>
      <span className="font-heading text-[1.35rem] leading-tight font-semibold">{ticker(row.symbol)}</span>
      <span className="text-[0.8rem] font-normal opacity-75">
        {row.quantity} shares, {money(row.marketValue)}
      </span>
      {why && <span className="mt-1 text-[0.8rem] font-normal text-danger">{why}</span>}
    </Choice>
  )
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-2 text-sm text-ink-soft">
      {label}
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg bg-paper-2 px-[15px] py-[13px] text-base text-ink shadow-[inset_0_0_0_1.5px_var(--line)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--ink)]"
      />
    </label>
  )
}

const FRAME = 'rounded-xl bg-paper-2 p-6 shadow-[inset_0_0_0_1.5px_var(--line)] lg:sticky lg:top-6'

function PlanSummary({
  rows,
  selected,
  when,
  days,
  preview,
  fetching,
  error,
  onProtect,
  protecting,
}: {
  rows: MarketRow[]
  selected: string[]
  when: When
  days: number
  preview: PlanPreview | undefined
  fetching: boolean
  error: ApiError | null
  onProtect: () => void
  protecting: boolean
}) {
  if (!selected.length) return <aside className={FRAME}><p className="leading-relaxed text-ink-soft">Pick at least one stock to see what the protection would do.</p></aside>
  if (error) return <Blocked title="This cannot be scheduled" reasons={error.blockers.length ? error.blockers : [error.message]} />
  if (!preview) return <aside className={FRAME}><Loader compact label="Reading the account and the market calendar" /></aside>

  const stockValue = rows.filter((r) => selected.includes(r.symbol)).reduce((sum, r) => sum + Number(r.marketValue), 0)
  const protectedValue = Number(preview.totalNotionalPerRun)
  const runs = preview.runs.filter((r) => !r.skipped)
  const skipped = preview.runs.filter((r) => r.skipped)
  const names = selected.length <= 3 ? selected.map(ticker).join(', ') : `${selected.length} stocks`
  const label = WHENS.find((w) => w.value === when)!.label.toLowerCase()

  return (
    <aside className={FRAME} aria-busy={fetching}>
      <h2 className="font-heading text-[2.2rem] leading-none font-semibold tracking-[-0.5px]">{names}</h2>
      <p className="mt-2 text-sm text-ink-soft">
        {label === 'custom' ? 'Custom hours' : label[0]!.toUpperCase() + label.slice(1)}, {days === 1 ? 'once' : `every day for ${days} days`}
      </p>

      <dl className="mt-5 grid grid-cols-2 gap-4">
        <div>
          <dt className="text-sm text-ink-soft">Protected each time</dt>
          <dd className="font-heading text-[2.4rem] leading-tight font-medium tracking-[-0.6px]">{money(protectedValue)}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-soft">Still exposed</dt>
          <dd className="font-heading text-[2.4rem] leading-tight font-medium tracking-[-0.6px] text-ink-soft">{money(Math.max(0, stockValue - protectedValue))}</dd>
        </div>
      </dl>

      <div className="mt-6 border-t border-line pt-5">
        <p className="text-sm font-bold">{runs.length === 1 ? 'When it runs' : `${runs.length} times`}, your time</p>
        <ul className="mt-2">
          {runs.slice(0, 7).map((r) => (
            <LineRow
              key={r.date}
              label={dayLabel(r.startIso)}
              value={`${clock(r.startIso)} to ${clock(r.endIso)}`}
              sub={IN_NEW_YORK() ? undefined : `${nyTime(r.startIso)} to ${nyTime(r.endIso)} in New York`}
            />
          ))}
        </ul>
        {runs.length > 7 && <p className="mt-2 text-sm text-ink-soft">and {runs.length - 7} more</p>}
        {skipped.length > 0 && <p className="mt-2 text-[0.8rem] leading-relaxed text-ink-faint">Skipped, the US market is shut: {skipped.map((r) => dateOnly(r.date)).join(', ')}</p>}
        {runs.some((r) => r.closeRule === 'CONVERGENCE') && (
          <p className="mt-2 text-[0.8rem] leading-relaxed text-ink-faint">
            Pre-market hedges close after the US market opens at {clock(nyWallClock('09:30'))} your time, once the perp and the stock price agree.
          </p>
        )}
      </div>

      <div className="mt-6 border-t border-line pt-5">
        <ScenarioTable ticker={selected.length === 1 ? ticker(selected[0]!) : 'the stocks'} stockValue={stockValue} hedgeNotional={protectedValue} />
        <p className="mt-2 text-[0.8rem] leading-relaxed text-ink-faint">Before costs: trading fees each time the hedge opens and closes, and funding while it is open.</p>
      </div>

      <details className="group mt-5 border-t border-line pt-4">
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-bold text-ink-soft [&::-webkit-details-marker]:hidden">
          Each stock
          <span className="font-mono text-ink-faint transition-transform duration-150 ease-out-strong group-open:rotate-45" aria-hidden>
            +
          </span>
        </summary>
        <div className="mt-2">
          {preview.stocks.map((s) => (
            <LineRow key={s.symbol} label={ticker(s.symbol)} sub={s.issues.join(', ') || undefined} value={`${money(s.notional)} on ${s.quantity} shares`} />
          ))}
          {preview.leverage !== null && <LineRow label="Leverage" value={`${preview.leverage}x for every stock`} sub="From today's margin, checked again as each window opens" />}
        </div>
      </details>

      {preview.blockers.length > 0 && (
        <ul className="mt-5 space-y-1 border-l-2 border-danger pl-3 leading-relaxed text-danger">
          {preview.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}

      <Button size="lg" className="mt-6 w-full" disabled={!preview.canCreate || protecting} onClick={onProtect}>
        {protecting ? 'Scheduling' : `Protect ${names}`}
      </Button>
      {preview.canCreate && (
        <p className="mt-3 text-[0.8rem] leading-relaxed text-ink-faint">
          At the start of each window ProX places a real order on Backpack for every stock, and closes it at the end. Keep the backend running.
        </p>
      )}
    </aside>
  )
}

function WeekendSummary({
  rows,
  selected,
  previews,
  group,
  groupError,
  fetching,
  onProtect,
  protecting,
}: {
  rows: MarketRow[]
  selected: string[]
  previews: WeekendPreview[] | undefined
  /** Null for a single stock; undefined while the group check loads. */
  group: GroupPreview | null | undefined
  groupError: ApiError | null
  fetching: boolean
  onProtect: () => void
  protecting: boolean
}) {
  if (!selected.length) return <aside className={FRAME}><p className="leading-relaxed text-ink-soft">Pick at least one stock to see what the protection would do.</p></aside>
  if (groupError) return <Blocked title="These cannot be hedged together" reasons={groupError.blockers.length ? groupError.blockers : [groupError.message]} />
  if (!previews || group === undefined) return <aside className={FRAME}><Loader compact label="Reading the account and the order book" /></aside>

  const ok = previews.filter((p): p is { symbol: string; preview: Preview } => 'preview' in p)
  const reasons = [
    ...previews.flatMap((p) => ('error' in p ? [`${ticker(p.symbol)}: ${p.error.blockers.join(', ') || p.error.message}`] : p.preview.blockers.map((b) => `${ticker(p.symbol)}: ${b}`))),
    ...(group?.blockers ?? []),
  ]
  const stockValue = rows.filter((r) => selected.includes(r.symbol)).reduce((sum, r) => sum + Number(r.marketValue), 0)
  const protectedValue = ok.reduce((sum, p) => sum + Number(p.preview.targetNotional), 0)
  const first = ok[0]?.preview
  const single = ok.length === 1 ? first : undefined
  const names = selected.length <= 3 ? selected.map(ticker).join(', ') : `${selected.length} stocks`
  const canProtect = reasons.length === 0 && ok.length === selected.length && ok.every((p) => p.preview.canActivate && Number(p.preview.orderQuantity) > 0)

  return (
    <aside className={FRAME} aria-busy={fetching}>
      <h2 className="font-heading text-[2.2rem] leading-none font-semibold tracking-[-0.5px]">{names}</h2>
      <p className="mt-2 text-sm text-ink-soft">Over the weekend</p>

      <dl className="mt-5 grid grid-cols-2 gap-4">
        <div>
          <dt className="text-sm text-ink-soft">Protected</dt>
          <dd className="font-heading text-[2.4rem] leading-tight font-medium tracking-[-0.6px]">{money(protectedValue)}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-soft">Still exposed</dt>
          <dd className="font-heading text-[2.4rem] leading-tight font-medium tracking-[-0.6px] text-ink-soft">{money(Math.max(0, stockValue - protectedValue))}</dd>
        </div>
      </dl>

      {first && (
        <div className="mt-6 border-t border-line pt-5">
          <WindowTrack endsAt={first.reopenAt} hardStopAt={first.maxEndAt} />
        </div>
      )}

      <div className="mt-6 border-t border-line pt-5">
        <ScenarioTable ticker={selected.length === 1 ? ticker(selected[0]!) : 'the stocks'} stockValue={stockValue} hedgeNotional={protectedValue} />
        <p className="mt-2 text-[0.8rem] leading-relaxed text-ink-faint">
          Before costs. The round trip costs about {money(ok.reduce((sum, p) => sum + Number(p.preview.costs.tradingFeeRoundTrip), 0), true)} in fees, plus funding while the short is open.
        </p>
      </div>

      {single && (
        <details className="group mt-5 border-t border-line pt-4">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-bold text-ink-soft [&::-webkit-details-marker]:hidden">
            How the hedge is built
            <span className="font-mono text-ink-faint transition-transform duration-150 ease-out-strong group-open:rotate-45" aria-hidden>
              +
            </span>
          </summary>
          <div className="mt-2">
            <LineRow label="Order" value={`Short ${single.orderQuantity} ${perpName(single.perpSymbol)} perp`} />
            <LineRow label="Leverage" value={single.leverage ? `${single.leverage}x` : 'n/a'} />
            <LineRow label="Risk after opening" value={single.projectedRisk ? <RiskBadge state={single.projectedRisk} /> : 'n/a'} />
            <LineRow label="Margin used after" value={percent(single.projectedMmr)} />
            <LineRow label="Free margin now" value={money(single.account.netEquityAvailable)} />
            <LineRow label="Counts as collateral" value={money(single.collateralValue)} />
          </div>
        </details>
      )}

      {group && group.leverage !== null && (
        <details className="group mt-5 border-t border-line pt-4">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-bold text-ink-soft [&::-webkit-details-marker]:hidden">
            How the hedges are built
            <span className="font-mono text-ink-faint transition-transform duration-150 ease-out-strong group-open:rotate-45" aria-hidden>
              +
            </span>
          </summary>
          <div className="mt-2">
            {ok.map((p) => (
              <LineRow key={p.symbol} label={ticker(p.symbol)} value={`Short ${p.preview.orderQuantity} ${perpName(p.preview.perpSymbol)} perp`} />
            ))}
            <LineRow label="Leverage" value={`${group.leverage}x for every stock`} sub="They share one account, so they must fit side by side" />
            <LineRow label="Margin used after" value={percent(group.projectedMmr)} />
            <LineRow label="Free margin now" value={money(group.freeMargin)} />
          </div>
        </details>
      )}

      {reasons.length > 0 && (
        <ul className="mt-5 space-y-1 border-l-2 border-danger pl-3 leading-relaxed text-danger">
          {reasons.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}

      <Button size="lg" className="mt-6 w-full" disabled={!canProtect || protecting} onClick={onProtect}>
        {protecting ? 'Placing the hedges' : `Protect ${money(protectedValue)} of ${names}`}
      </Button>
      {canProtect && (
        <p className="mt-3 text-[0.8rem] leading-relaxed text-ink-faint">
          This places real orders on Backpack now, one short per stock, filled at once or not at all. They close after Monday&apos;s open once the perp and the stock price agree.
        </p>
      )}
    </aside>
  )
}

function Blocked({ title, reasons }: { title: string; reasons: string[] }) {
  return (
    <aside className={FRAME}>
      <h2 className="font-heading text-[1.5rem] font-semibold tracking-[-0.3px]">{title}</h2>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 leading-relaxed text-ink-soft">
        {reasons.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
    </aside>
  )
}

function presetReason(reason: string | null | undefined, row: MarketRow): string {
  if (reason === 'BELOW_MINIMUM') return `Too small for this level: the perp minimum is ${row.minQuantity}`
  if (reason === 'OFF_GRID') return `Cannot be sized exactly: the perp trades in steps of ${row.stepSize}`
  return reason ?? 'Unavailable'
}

function ticker(symbol: string): string {
  return symbol.replace(/\.US$/, '')
}

function perpName(perpSymbol: string): string {
  return perpSymbol.replace(/(\.US)?_USDC_PERP$/, '')
}
