'use client'

// The real market state, read from the backend. If the backend is not reachable the strip simply
// does not render; the landing page never depends on it.

import { useQuery } from '@tanstack/react-query'
import { useNow } from '@/hooks/use-now'
import { api } from '@/lib/api'
import { SESSION_LABEL } from '@/lib/format'
import { timeUntil } from '@/lib/hedge'

export function LiveSession() {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, retry: false, refetchInterval: 60_000 })
  const now = useNow()
  if (!health.data) return null
  const { state, nextRegularOpen, holidayName } = health.data.session
  const open = state === 'REGULAR'
  const opensIn = now === null ? null : timeUntil(nextRegularOpen, now)
  return (
    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-ink-soft">
      <span className={`size-2 rounded-full ${open ? 'bg-ink' : 'bg-gold'}`} aria-hidden />
      <span>
        Right now the US market is <span className="font-bold text-ink">{(holidayName ?? SESSION_LABEL[state] ?? state).toLowerCase()}</span>
        {open ? '.' : opensIn ? `. It opens in ${opensIn}.` : '.'}
      </span>
    </p>
  )
}
