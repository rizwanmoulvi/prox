'use client'

// The life of one protection on a line: it opens now, the window ends, and there is a time by
// which it closes whatever happens.

import { useNow } from '@/hooks/use-now'
import { whenShort } from '@/lib/format'
import { timeUntil } from '@/lib/hedge'

export function WindowTrack({ endsAt, hardStopAt }: { endsAt: string; hardStopAt: string }) {
  const now = useNow()
  const start = now ?? new Date(endsAt).getTime()
  const end = new Date(endsAt).getTime()
  const stop = new Date(hardStopAt).getTime()
  const span = Math.max(1, stop - start)
  // Keep the middle marker readable even when the window is far longer than the wait after it.
  const endAt = Math.min(0.82, Math.max(0.18, (end - start) / span))
  const lasts = now === null ? null : timeUntil(endsAt, now)
  return (
    <div>
      <div className="relative mx-1.5 h-9" aria-hidden>
        <div className="absolute top-1/2 right-0 left-0 h-px -translate-y-1/2 border-t border-dashed border-ink-faint" />
        <div className="absolute top-1/2 left-0 h-[3px] -translate-y-1/2 rounded-full bg-ink" style={{ width: `${endAt * 100}%` }} />
        <span className="absolute top-1/2 left-0 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink" />
        <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold shadow-[0_0_0_3px_var(--paper-2)]" style={{ left: `${endAt * 100}%` }} />
        <span className="absolute top-1/2 right-0 size-3 translate-x-1/2 -translate-y-1/2 rounded-full bg-paper-2 shadow-[inset_0_0_0_1.5px_var(--ink-faint)]" />
      </div>
      <ol className="grid grid-cols-3 gap-2 text-[0.8rem] leading-snug">
        <li>
          <span className="block font-bold">Now</span>
          <span className="text-ink-soft">Hedge opens</span>
        </li>
        <li className="text-center">
          <span className="block font-bold">{whenShort(endsAt)}</span>
          <span className="text-ink-soft">Window ends{lasts ? `, in ${lasts}` : ''}</span>
        </li>
        <li className="text-right">
          <span className="block font-bold">{whenShort(hardStopAt)}</span>
          <span className="text-ink-soft">Latest close</span>
        </li>
      </ol>
    </div>
  )
}
