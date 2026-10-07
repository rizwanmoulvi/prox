'use client'

// Where the US cash market is in its day. The product exists for the hours it is shut, so this
// is the one status every screen keeps in view.

import { useNow } from '@/hooks/use-now'
import type { SessionSnapshot } from '@/lib/api'
import { SESSION_LABEL, whenShort } from '@/lib/format'
import { timeUntil } from '@/lib/hedge'

const PHASES: { key: string; label: string; states: string[] }[] = [
  { key: 'pre', label: 'Pre-market', states: ['PREMARKET'] },
  { key: 'open', label: 'Open', states: ['REGULAR'] },
  { key: 'post', label: 'After hours', states: ['POSTMARKET'] },
  { key: 'closed', label: 'Closed', states: ['OVERNIGHT', 'WEEKEND', 'HOLIDAY'] },
]

export function SessionCard({ session }: { session: SessionSnapshot }) {
  const now = useNow()
  const open = session.state === 'REGULAR'
  const opensIn = now === null ? null : timeUntil(session.nextRegularOpen, now)
  return (
    <section aria-label="US market session">
      <p className="text-sm text-ink-soft">US stock market</p>
      <p className="mt-1 font-heading text-[1.9rem] leading-none font-medium tracking-[-0.4px]">
        {session.holidayName ?? SESSION_LABEL[session.state] ?? session.state}
      </p>
      <ol className="mt-4 grid grid-cols-4 gap-1" aria-hidden>
        {PHASES.map((phase) => {
          const current = phase.states.includes(session.state)
          return (
            <li key={phase.key} className="flex flex-col gap-1.5">
              <span className={`h-1.5 rounded-full ${current ? (open ? 'bg-ink' : 'bg-gold') : 'bg-paper-3'}`} />
              <span className={`text-[0.7rem] ${current ? 'font-bold text-ink' : 'text-ink-faint'}`}>{phase.label}</span>
            </li>
          )
        })}
      </ol>
      <p className="mt-4 text-sm leading-relaxed text-ink-soft">
        {open
          ? 'The cash market is trading, so the perp and the stock price stay close.'
          : opensIn
            ? `Opens in ${opensIn}, on ${whenShort(session.nextRegularOpen)}. Until then your stock can move with nothing to anchor it.`
            : 'Waiting for the next session time.'}
      </p>
    </section>
  )
}
