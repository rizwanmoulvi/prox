// Maintenance margin as a share of equity. Backpack liquidates at 100 percent.

import { RiskBadge } from '@/components/risk-badge'
import type { RiskState } from '@/lib/api'

const FILL: Record<RiskState, string> = { SAFE: 'bg-ink', WATCH: 'bg-gold', RISK: 'bg-gold-deep', REDUCE: 'bg-danger', EMERGENCY: 'bg-danger' }

export function MarginMeter({ mmr, risk }: { mmr: string | number; risk: RiskState }) {
  const value = Number(mmr)
  const share = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1
  const percent = Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'over 100%'
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm text-ink-soft">Margin used</p>
          <p className="mt-1 font-heading text-[1.9rem] leading-none font-medium tracking-[-0.4px]">{percent}</p>
        </div>
        <RiskBadge state={risk} />
      </div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
        aria-label="Maintenance margin used"
        className="mt-4 h-1.5 overflow-hidden rounded-full bg-paper-3"
      >
        <div className={`h-full origin-left rounded-full transition-transform duration-500 ease-out-strong ${FILL[risk]}`} style={{ transform: `scaleX(${Math.max(share, 0.01)})` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[0.7rem] text-ink-faint">
        <span>0%</span>
        <span>Backpack liquidates at 100%</span>
      </div>
    </div>
  )
}
