'use client'

// One flow for every protection: which stocks, when, for how long. Weekend cover is a one-off
// protection that lifts after Monday's open; everything else is a scheduled plan.

import { useMutation, useQuery } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ErrorCard } from '@/components/error-card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api, ApiError, type MarketRow, type PlanPreview, type PlanRequest, type Preview } from '@/lib/api'
import { money } from '@/lib/format'
import { DAY_OPTIONS, etAndLocal, localDay, ticker, WHEN_OPTIONS, type WhenKind } from '@/lib/plain'

const LEVELS = [10_000, 7500, 5000, 2500]
type WeekendPreview = { symbol: string; preview: Preview } | { symbol: string; error: ApiError }

export default function ProtectPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <ProtectFlow />
    </Suspense>
  )
}

function ProtectFlow() {
  const router = useRouter()
  const params = useSearchParams()
  const markets = useQuery({ queryKey: ['markets'], queryFn: api.markets, refetchInterval: 30_000 })
  const [picked, setPicked] = useState<string[] | null>(() => {
    const fromUrl = (params.get('symbols') ?? '').split(',').filter(Boolean)
    return fromUrl.length ? fromUrl : null
  })
  const [when, setWhen] = useState<WhenKind>('OVERNIGHT')
  const [days, setDays] = useState(1)
  const [customDays, setCustomDays] = useState('')
  const [level, setLevel] = useState(10_000)
  const [adjust, setAdjust] = useState(false)
  const [customStart, setCustomStart] = useState('20:00')
  const [customEnd, setCustomEnd] = useState('04:00')

  const rows = useMemo(() => markets.data ?? [], [markets.data])
  const eligibleSymbols = useMemo(() => rows.filter((r) => r.eligible && r.presets.find((p) => p.bps === level)?.available).map((r) => r.symbol), [rows, level])
  // Until the user touches the list, everything that can be covered is selected.
  const selected = picked ?? eligibleSymbols
  const chosen = selected.filter((s) => rows.some((r) => r.symbol === s))
  const planRequest = useMemo<PlanRequest | null>(() => {
    if (!chosen.length || when === 'WEEKEND') return null
    return { stockSymbols: chosen, protectionBps: level, window: when === 'CUSTOM' ? { kind: 'CUSTOM', customStart, customEnd } : { kind: when }, days }
  }, [chosen, when, level, days, customStart, customEnd])

  const planPreview = useQuery({ queryKey: ['plan-preview', planRequest], queryFn: () => api.planPreview(planRequest!), enabled: !!planRequest, refetchInterval: 15_000, retry: false })
  const weekend = useQuery({
    queryKey: ['weekend-preview', chosen, level],
    queryFn: (): Promise<WeekendPreview[]> =>
      Promise.all(
        chosen.map((symbol) =>
          api
            .preview({ stockSymbol: symbol, protectionBps: level, mode: 'WEEKEND' })
            .then((preview) => ({ symbol, preview }))
            .catch((error: ApiError) => ({ symbol, error })),
        ),
      ),
    enabled: when === 'WEEKEND' && chosen.length > 0,
    refetchInterval: 15_000,
    retry: false,
  })

  const protect = useMutation({
    mutationFn: async () => {
      if (when !== 'WEEKEND') {
        const created = await api.createPlan(planRequest!)
        return { kind: 'plan' as const, id: created.plan.id }
      }
      const results = await Promise.all(
        chosen.map((symbol) =>
          api
            .activate({ stockSymbol: symbol, protectionBps: level, mode: 'WEEKEND' })
            .then(() => ({ symbol, ok: true as const }))
            .catch((error: Error) => ({ symbol, ok: false as const, error })),
        ),
      )
      const failed = results.filter((r) => !r.ok)
      if (failed.length) toast.error(`${failed.map((f) => ticker(f.symbol)).join(', ')}: ${(failed[0] as { error: Error }).error.message}`)
      return { kind: 'weekend' as const, ok: results.length - failed.length }
    },
    onSuccess: (result) => {
      if (result.kind === 'plan') {
        toast.success('Protection scheduled')
        router.push(`/plans/${result.id}`)
        return
      }
      if (result.ok) toast.success(`${result.ok} stock${result.ok === 1 ? '' : 's'} covered for the weekend`)
      router.push('/')
    },
    onError: (e) => toast.error(e instanceof ApiError ? [e.message, ...e.blockers].join(' ') : (e as Error).message),
  })

  if (markets.isError) return <ErrorCard title="Could not read your stocks" message={(markets.error as Error).message} />
  if (!markets.data) return <Skeleton className="h-64 w-full" />
  if (!rows.length) return <ErrorCard title="Nothing to protect yet" message="Buy a tokenized stock on Backpack and it will appear here." />

  const toggle = (symbol: string) => setPicked(selected.includes(symbol) ? selected.filter((x) => x !== symbol) : [...selected, symbol])
  const blockers =
    when === 'WEEKEND'
      ? (weekend.data ?? []).flatMap((x) => ('error' in x ? [`${ticker(x.symbol)}: ${x.error.blockers?.join(', ') || x.error.message}`] : x.preview.blockers.map((b) => `${ticker(x.symbol)}: ${b}`)))
      : [...(planPreview.data?.blockers ?? []), ...(planPreview.error instanceof ApiError ? [planPreview.error.message] : [])]
  const ready = chosen.length > 0 && blockers.length === 0 && (when === 'WEEKEND' ? !!weekend.data : !!planPreview.data?.canCreate)
  const runs = planPreview.data?.runs.filter((r) => !r.skipped) ?? []
  const skipped = planPreview.data?.runs.filter((r) => r.skipped) ?? []

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-10">
      <header>
        <h1 className="text-2xl font-semibold">Protect your stocks</h1>
        <p className="mt-1 text-muted-foreground">Your shares stay in your account. We cover their value for the hours you choose and lift the cover afterwards.</p>
      </header>

      <Step n={1} title="Which stocks">
        <div className="flex flex-wrap gap-2">
          {rows.map((row) => (
            <StockChip key={row.symbol} row={row} level={level} checked={chosen.includes(row.symbol)} onToggle={() => toggle(row.symbol)} />
          ))}
        </div>
      </Step>

      <Step n={2} title="When">
        <div className="grid gap-2 sm:grid-cols-2">
          {WHEN_OPTIONS.map((w) => (
            <Choice key={w.kind} active={when === w.kind} onClick={() => setWhen(w.kind)} title={w.label} hint={w.hint} />
          ))}
        </div>
        {when === 'CUSTOM' && (
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <label className="flex flex-col gap-1">
              From (New York time)
              <input type="time" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="rounded-lg border bg-background px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1">
              To (New York time)
              <input type="time" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="rounded-lg border bg-background px-3 py-2" />
            </label>
          </div>
        )}
      </Step>

      {when !== 'WEEKEND' && (
        <Step n={3} title="For how long">
          <div className="flex flex-wrap gap-2">
            {DAY_OPTIONS.map((d) => (
              <Choice
                key={d.days}
                active={days === d.days && !customDays}
                onClick={() => {
                  setDays(d.days)
                  setCustomDays('')
                }}
                title={d.label}
                compact
              />
            ))}
            <label className="flex items-center gap-2 rounded-xl border px-3 text-sm">
              <input
                type="number"
                min={1}
                max={60}
                placeholder="days"
                value={customDays}
                onChange={(e) => {
                  setCustomDays(e.target.value)
                  const n = Number(e.target.value)
                  if (n >= 1) setDays(Math.min(60, n))
                }}
                className="w-16 bg-transparent py-2 outline-none"
              />
            </label>
          </div>
        </Step>
      )}

      <section className="rounded-2xl border bg-muted/40 p-5">
        <p className="text-sm text-muted-foreground">Summary</p>
        <p className="mt-1 text-lg">{summaryOf(when, days, level, chosen, planPreview.data, weekend.data)}</p>
        {runs.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 text-sm text-muted-foreground">
            {runs.slice(0, 6).map((r) => (
              <li key={r.date}>
                {localDay(r.startIso)}: {etAndLocal(r.startIso)} to {etAndLocal(r.endIso)}
              </li>
            ))}
            {runs.length > 6 && <li>and {runs.length - 6} more</li>}
            {skipped.length > 0 && <li>Skipped (market closed): {skipped.map((r) => r.date).join(', ')}</li>}
          </ul>
        )}
        <button onClick={() => setAdjust((a) => !a)} className="mt-3 text-sm underline-offset-4 hover:underline">
          {adjust ? 'Hide' : 'Adjust cover level'}
        </button>
        {adjust && (
          <div className="mt-2 flex gap-2">
            {LEVELS.map((l) => (
              <Choice key={l} active={level === l} onClick={() => setLevel(l)} title={`${l / 100}%`} compact />
            ))}
          </div>
        )}
        {blockers.length > 0 && (
          <ul className="mt-3 list-disc pl-5 text-sm text-red-700 dark:text-red-300">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
      </section>

      <div className="sticky bottom-4 z-10 rounded-2xl border bg-background/95 p-4 shadow-lg backdrop-blur">
        <Button size="lg" className="w-full" disabled={!ready || protect.isPending} onClick={() => protect.mutate()}>
          {protect.isPending ? 'Setting up cover…' : chosen.length ? `Protect ${chosen.length === 1 ? ticker(chosen[0]!) : `${chosen.length} stocks`}` : 'Pick a stock'}
        </Button>
        <p className="mt-2 text-center text-xs text-muted-foreground">Cost is settled from your USDC balance. A night of cover typically costs a few cents per $1,000.</p>
      </div>
    </div>
  )
}

function summaryOf(when: WhenKind, days: number, level: number, chosen: string[], planPreview: PlanPreview | undefined, weekend: WeekendPreview[] | undefined): string {
  if (!chosen.length) return 'Pick at least one stock.'
  const names = chosen.length <= 3 ? chosen.map(ticker).join(', ') : `${chosen.length} stocks`
  const pct = level === 10_000 ? 'all' : `${level / 100}%`
  if (when === 'WEEKEND') {
    const covered = (weekend ?? []).reduce((sum, x) => sum + ('preview' in x ? Number(x.preview.targetNotional) : 0), 0)
    return `Cover ${pct} of ${names} over the weekend, about ${money(covered)}, lifted after Monday's open once prices settle.`
  }
  const label = WHEN_OPTIONS.find((w) => w.kind === when)!.label.toLowerCase()
  const covered = planPreview ? money(planPreview.totalNotionalPerRun) : '…'
  return `Cover ${pct} of ${names} ${label}, ${days === 1 ? 'once' : `every day for ${days} days`}. About ${covered} covered each time.`
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <span className="flex size-5 items-center justify-center rounded-full bg-foreground text-[11px] text-background">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Choice({ active, onClick, title, hint, compact }: { active: boolean; onClick: () => void; title: string; hint?: string; compact?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border text-left transition-colors ${compact ? 'px-4 py-2 text-sm' : 'px-4 py-3'} ${active ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted'}`}
    >
      <span className="block font-medium">{title}</span>
      {hint && <span className={`block text-xs ${active ? 'text-background/70' : 'text-muted-foreground'}`}>{hint}</span>}
    </button>
  )
}

function StockChip({ row, level, checked, onToggle }: { row: MarketRow; level: number; checked: boolean; onToggle: () => void }) {
  const preset = row.presets.find((p) => p.bps === level)
  const ok = row.eligible && !!preset?.available
  const why = !row.eligible ? row.reasons.join(', ') : preset?.reason === 'BELOW_MINIMUM' ? 'position too small to cover at this level' : preset?.reason === 'OFF_GRID' ? 'cannot cover exactly at this level' : ''
  return (
    <button
      onClick={onToggle}
      disabled={!ok}
      className={`flex min-w-36 flex-col items-start rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-50 ${checked ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted'}`}
    >
      <span className="font-semibold">{ticker(row.symbol)}</span>
      <span className={`text-xs ${checked ? 'text-background/70' : 'text-muted-foreground'}`}>
        {row.quantity} shares · {money(row.marketValue)}
      </span>
      {why && <span className="mt-1 text-xs text-red-700 dark:text-red-300">{why}</span>}
    </button>
  )
}
