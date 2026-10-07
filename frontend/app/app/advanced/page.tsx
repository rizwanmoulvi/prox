'use client'

// The account as Backpack reports it, laid out to be read. The raw JSON is one click away under
// each section, for when the exact field matters.

import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ErrorCard } from '@/components/error-card'
import { Loader } from '@/components/loader'
import { api, API_URL } from '@/lib/api'
import { when } from '@/lib/format'

type Row = Record<string, unknown>

export default function AdvancedPage() {
  const advanced = useQuery({ queryKey: ['advanced'], queryFn: api.advanced, refetchInterval: 15_000 })
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 15_000 })
  const reports = useQuery({ queryKey: ['attestations'], queryFn: api.attestations, refetchInterval: 15_000 })
  if (advanced.isError) return <ErrorCard title="Could not read the account" message={(advanced.error as Error).message} />
  if (!advanced.data) return <Loader label="Reading the account" />

  const data = advanced.data
  const collateral = (data.collateral ?? {}) as Row
  const collateralRows = Array.isArray(collateral.collateral) ? (collateral.collateral as Row[]) : []
  const positions = Array.isArray(data.positions) ? (data.positions as Row[]) : []
  const openOrders = Array.isArray(data.openOrders) ? (data.openOrders as Row[]) : []
  const balances = balanceRows(data.balances)
  const lamports = data.anchorBalanceLamports

  return (
    <div className="flex flex-col gap-14">
      <header>
        <h1 className="font-heading text-[clamp(2.2rem,6vw,3.2rem)] leading-[1.02] font-semibold tracking-[-0.6px]">Advanced</h1>
        <p className="mt-3 max-w-[60ch] leading-relaxed text-ink-soft">Everything ProX reads from Backpack to make its decisions, plus the state of the backend and the oracle.</p>
      </header>

      <Section title="Open positions" source="GET /api/v1/position" raw={positions}>
        <DataTable
          rows={positions}
          empty="No open positions."
          columns={[
            ['symbol', 'Market'],
            ['netQuantity', 'Size'],
            ['entryPrice', 'Entry'],
            ['markPrice', 'Mark'],
            ['pnlUnrealized', 'Unrealised PnL'],
            ['estLiquidationPrice', 'Liquidation price'],
          ]}
        />
      </Section>

      <Section title="Collateral" source="GET /api/v1/capital/collateral" raw={collateral}>
        <DataTable
          rows={collateralRows}
          empty="No collateral."
          columns={[
            ['symbol', 'Asset'],
            ['totalQuantity', 'Quantity'],
            ['assetMarkPrice', 'Price'],
            ['balanceNotional', 'Value'],
            ['collateralWeight', 'Weight'],
            ['collateralValue', 'Counts as'],
          ]}
        />
        <Facts data={collateral} className="mt-8" />
      </Section>

      <div className="grid gap-x-16 gap-y-14 lg:grid-cols-2">
        <Section title="Open orders" source="GET /api/v1/orders" raw={openOrders}>
          <DataTable
            rows={openOrders}
            empty="No open orders. ProX orders fill at once or cancel, so none should rest here."
            columns={[
              ['symbol', 'Market'],
              ['side', 'Side'],
              ['quantity', 'Quantity'],
              ['price', 'Price'],
              ['status', 'Status'],
            ]}
          />
        </Section>
        <Section title="Balances" source="GET /api/v1/capital" raw={data.balances}>
          <DataTable
            rows={balances}
            empty="No balances."
            columns={[
              ['asset', 'Asset'],
              ['available', 'Available'],
              ['locked', 'Locked'],
              ['staked', 'Staked'],
            ]}
          />
        </Section>
        <Section title="Account settings" source="GET /api/v1/account" raw={data.account}>
          <Facts data={(data.account ?? {}) as Row} />
        </Section>
        <Section title="Backend" source="GET /api/health" raw={health.data}>
          {health.data ? (
            <Facts
              data={{
                trading: health.data.tradingEnabled ? 'On' : 'Off',
                demoMode: health.data.demoMode ? 'On' : 'Off',
                oracleMode: health.data.creMode,
                lastOracleRun: health.data.creSimulation ? `${health.data.creSimulation.ok ? 'Succeeded' : 'Failed'} ${when(health.data.creSimulation.at)}` : 'Has not run',
                backpackSocket: health.data.socket ? 'Connected' : 'Disconnected',
                solanaAnchoring: health.data.anchoring ? 'On' : 'Off',
                anchorWalletBalance: typeof lamports === 'number' ? `${(lamports / 1e9).toFixed(4)} SOL` : 'n/a',
              }}
            />
          ) : (
            <Loader compact />
          )}
          {health.data?.creSimulation && !health.data.creSimulation.ok && (
            <p className="mt-4 border-l-2 border-danger pl-3 font-mono text-[0.78rem] leading-relaxed break-words text-danger">{health.data.creSimulation.detail.slice(-300)}</p>
          )}
        </Section>
      </div>

      <Section title="Oracle reports" source="GET /api/attestations" raw={reports.data}>
        {!reports.data?.length ? (
          <p className="leading-relaxed text-ink-soft">No reports received yet. They arrive while a protection is live.</p>
        ) : (
          <ul>
            {reports.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line-soft py-3 text-sm last:border-b-0">
                <a className="font-mono text-gold-deep" href={`${API_URL}/api/attestations/${r.reportHash}`} target="_blank" rel="noreferrer">
                  {r.reportHash.slice(0, 10)}…{r.reportHash.slice(-8)}
                </a>
                <span className="text-ink-soft">{when(r.observedAt)}</span>
                <span className="ml-auto text-ink-soft">{r.mode === 'DON' ? `Signed by ${r.validSignatures} nodes` : 'Local simulation'}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

function Section({ title, source, raw, children }: { title: string; source: string; raw: unknown; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-heading text-[1.6rem] font-semibold tracking-[-0.3px]">{title}</h2>
        <span className="font-mono text-[0.74rem] text-ink-faint">{source}</span>
      </div>
      {children}
      <details className="mt-4">
        <summary className="cursor-pointer text-sm text-ink-faint hover:text-ink-soft">Raw response</summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-paper-2 p-4 font-mono text-[0.74rem] leading-[1.55] shadow-[inset_0_0_0_1px_var(--line)]">{JSON.stringify(raw ?? null, null, 2)}</pre>
      </details>
    </section>
  )
}

function DataTable({ rows, columns, empty }: { rows: Row[]; columns: [key: string, label: string][]; empty: string }) {
  if (rows.length === 0) return <p className="leading-relaxed text-ink-soft">{empty}</p>
  return (
    <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[0.8rem] text-ink-faint">
            {columns.map(([key, label], i) => (
              <th key={key} scope="col" className={`pb-2.5 font-normal ${i === 0 ? '' : 'text-right'}`}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b border-line-soft last:border-b-0">
              {columns.map(([key], i) => (
                <td key={key} className={`py-3 ${i === 0 ? 'font-bold' : 'text-right font-mono text-[0.85rem]'}`}>
                  {cell(row[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Every plain value of an object as a label and value pair, in two columns on a wide screen. */
function Facts({ data, className = '' }: { data: Row; className?: string }) {
  const entries = Object.entries(data).filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v))
  return (
    <dl className={`grid gap-x-10 sm:grid-cols-2 ${className}`}>
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-baseline justify-between gap-4 border-b border-line-soft py-2.5">
          <dt className="text-sm text-ink-soft">{label(key)}</dt>
          <dd className="text-right font-mono text-[0.85rem] break-all">{cell(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

/** "netEquityAvailable" reads better as "Net equity available". */
const LABELS: Record<string, string> = { imf: 'Initial margin fraction', mmf: 'Maintenance margin fraction', pnlUnrealized: 'Unrealised PnL', autoRealizePnl: 'Auto realise PnL' }

function label(key: string): string {
  if (LABELS[key]) return LABELS[key]
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function cell(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'n/a'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string' && /^-?\d+\.\d{7,}$/.test(value)) return Number(value).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  return String(value)
}

/** Backpack returns balances keyed by asset; rows with nothing in them are left out. */
function balanceRows(balances: unknown): Row[] {
  if (!balances || typeof balances !== 'object') return []
  return Object.entries(balances as Record<string, Row>)
    .map(([asset, b]) => ({ asset, ...(b ?? {}) }))
    .filter((row) => ['available', 'locked', 'staked'].some((k) => Number((row as Row)[k]) > 0))
}
