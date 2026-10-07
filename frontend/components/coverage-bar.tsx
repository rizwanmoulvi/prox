// How much of the stock value is hedged right now. Ink is covered, bare paper is exposed.

import { money } from '@/lib/format'

export function CoverageBar({ covered, total, managed }: { covered: number; total: number; managed: boolean }) {
  const share = total > 0 ? Math.min(1, Math.max(0, covered / total)) : 0
  const percent = Math.round(share * 100)
  return (
    <div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={`${percent} percent of stock value is hedged`}
        className="h-3 overflow-hidden rounded-full bg-paper-3 shadow-[inset_0_0_0_1px_var(--line)]"
      >
        <div
          className={`h-full origin-left rounded-full transition-transform duration-500 ease-out-strong ${managed ? 'bg-gold' : 'bg-ink'}`}
          style={{ transform: `scaleX(${share})` }}
        />
      </div>
      <div className="mt-2.5 flex items-baseline justify-between gap-4 text-sm">
        <span>
          <span className="font-bold">{money(covered)}</span> <span className="text-ink-soft">hedged</span>
        </span>
        <span>
          <span className="font-bold">{money(Math.max(0, total - covered))}</span> <span className="text-ink-soft">exposed</span>
        </span>
      </div>
    </div>
  )
}
