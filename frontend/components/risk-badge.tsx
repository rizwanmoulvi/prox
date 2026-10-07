import { Badge } from '@/components/ui/badge'
import type { RiskState } from '@/lib/api'

const STYLE: Record<RiskState, string> = {
  SAFE: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  WATCH: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  RISK: 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200',
  REDUCE: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
  EMERGENCY: 'bg-red-600 text-white',
}

export function RiskBadge({ state }: { state: RiskState }) {
  return (
    <Badge variant="outline" className={`w-fit border-transparent ${STYLE[state] ?? ''}`}>
      {state}
    </Badge>
  )
}
