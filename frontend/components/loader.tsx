'use client'

// The one loading indicator: the Gather spinner from loading-dev, in ink on the paper.

import { Gather } from 'loading-dev'

export function Loader({ label, compact }: { label?: string; compact?: boolean }) {
  return (
    <div role="status" aria-live="polite" className={`flex flex-col items-center justify-center gap-4 text-ink ${compact ? 'min-h-40' : 'min-h-[45dvh]'}`}>
      <Gather size={compact ? 24 : 40} />
      {label ? <p className="font-heading text-ink-faint italic">{label}</p> : <span className="sr-only">Loading</span>}
    </div>
  )
}
