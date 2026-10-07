// The hashes of a protection's records, as written to Solana.

import type { PolicyDetail } from '@/lib/api'

const ANCHOR_LABEL: Record<string, string> = { OPENED: 'Hedge opened', CONVERGED: 'Prices agreed', RECEIPT: 'Receipt' }
const ANCHOR_STATUS: Record<string, string> = { PENDING: 'Being written', CONFIRMED: 'Written', FAILED: 'Failed', SKIPPED: 'Skipped' }

export function Anchors({ detail }: { detail: Pick<PolicyDetail, 'anchors'> }) {
  if (detail.anchors.length === 0) {
    return <p className="max-w-md leading-relaxed text-ink-soft">Nothing written to Solana yet. A hash is recorded when the hedge opens, when prices agree, and for the receipt.</p>
  }
  return (
    <ol>
      {detail.anchors.map((a) => (
        <li key={a.id} className="grid gap-x-6 gap-y-0.5 border-b border-line-soft py-3 last:border-b-0 sm:grid-cols-[14rem_1fr_auto]">
          <span className="font-bold">{ANCHOR_LABEL[a.kind] ?? a.kind}</span>
          <span className="font-mono text-[0.8rem] break-all text-ink-soft">sha256 {a.digest.slice(0, 24)}…</span>
          {a.signature ? (
            <a className="text-sm font-bold text-gold-deep" href={`https://explorer.solana.com/tx/${a.signature}`} target="_blank" rel="noreferrer">
              View transaction
            </a>
          ) : (
            <span className="text-sm text-ink-soft" title={a.error ?? undefined}>
              {ANCHOR_STATUS[a.status] ?? a.status}
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}
