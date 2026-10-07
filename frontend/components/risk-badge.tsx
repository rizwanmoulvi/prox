import { Badge } from '@/components/ui/badge'
import type { RiskState } from '@/lib/api'

// Umbra's palette is ink, gold and one oxblood red. Risk climbs through those: ink while calm,
// gold as it needs attention, red once the app is acting on it.
const STYLE: Record<RiskState, string> = {
  SAFE: 'text-ink shadow-[inset_0_0_0_1.5px_var(--line)]',
  WATCH: 'text-gold-deep shadow-[inset_0_0_0_1.5px_rgba(168,126,54,0.4)]',
  RISK: 'bg-gold-wash text-gold-deep shadow-[inset_0_0_0_1.5px_rgba(168,126,54,0.6)]',
  REDUCE: 'text-danger shadow-[inset_0_0_0_1.5px_var(--danger)]',
  EMERGENCY: 'bg-danger text-paper',
}

const LABEL: Record<RiskState, string> = { SAFE: 'Safe', WATCH: 'Watch', RISK: 'Risk', REDUCE: 'Reducing', EMERGENCY: 'Emergency' }

export function RiskBadge({ state }: { state: RiskState }) {
  return (
    <Badge variant="ghost" className={`w-fit font-sans text-xs font-bold tracking-[0.5px] uppercase hover:bg-transparent ${STYLE[state] ?? ''}`}>
      {LABEL[state] ?? state}
    </Badge>
  )
}
