// The whole idea in one picture: the market shuts, the price keeps moving, and the hedged
// position holds level until the market is back. The prices are invented to show the shape.

const SHARED = 'M20,152 L70,146 L120,156 L170,140 L220,148 L280,140'
const UNHEDGED = 'M280,140 L330,150 L380,168 L430,160 L480,190 L530,205 L580,198 L630,228 L680,240 L720,250 L770,244 L820,256 L870,246 L920,252 L980,242'
const HEDGED = 'M280,140 L330,141 L380,139 L430,141 L480,140 L530,142 L580,140 L630,141 L680,140 L720,141 L770,135 L820,147 L870,137 L920,143 L980,133'

export function GapChart() {
  return (
    <figure className="m-0">
      {/* A phone gets a tighter crop of the same drawing, so the lines stay readable. */}
      <Drawing id="wide" viewBox="0 0 1000 350" className="hidden overflow-visible sm:block" />
      <Drawing id="narrow" viewBox="205 60 700 262" className="overflow-hidden rounded-lg sm:hidden" strokeScale={1.7} />
      <figcaption className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink-soft">
        <span className="flex items-center gap-2">
          <span className="h-1 w-6 rounded-full bg-gold" aria-hidden />
          Stock with a ProX hedge
        </span>
        <span className="flex items-center gap-2">
          <span className="h-[3px] w-6 rounded-full bg-danger" aria-hidden />
          Stock on its own
        </span>
        <span className="text-ink-faint sm:ml-auto">An illustration. These are not real prices.</span>
      </figcaption>
    </figure>
  )
}

function Drawing({ id, viewBox, className, strokeScale = 1 }: { id: string; viewBox: string; className: string; strokeScale?: number }) {
  return (
    <svg viewBox={viewBox} role="img" aria-labelledby={`gap-title-${id} gap-desc-${id}`} className={`h-auto w-full ${className}`}>
        <title id={`gap-title-${id}`}>A stock price across a weekend, with and without ProX</title>
        <desc id={`gap-desc-${id}`}>
          The price is level until the market closes on Friday, falls while the market is shut, and opens lower on Monday. The hedged position stays level through the closure and keeps that value afterwards.
        </desc>

        <rect x="280" y="24" width="440" height="286" rx="10" className="fill-paper-3" opacity="0.55" />
        <line x1="20" y1="310" x2="980" y2="310" className="stroke-line" strokeWidth="1.5" />
        <line x1="280" y1="24" x2="280" y2="318" className="stroke-ink-faint" strokeWidth="1" strokeDasharray="3 5" />
        <line x1="720" y1="24" x2="720" y2="318" className="stroke-ink-faint" strokeWidth="1" strokeDasharray="3 5" />

        <path d={SHARED} fill="none" className="stroke-ink" strokeWidth={2.5 * strokeScale} strokeLinejoin="round" strokeLinecap="round" />
        <path d={UNHEDGED} pathLength={1} strokeDasharray="1" fill="none" className="animate-draw stroke-danger" strokeWidth={2.5 * strokeScale} strokeLinejoin="round" strokeLinecap="round" style={{ animationDelay: '250ms' }} />
        <path d={HEDGED} pathLength={1} strokeDasharray="1" fill="none" className="animate-draw stroke-gold" strokeWidth={4 * strokeScale} strokeLinejoin="round" strokeLinecap="round" style={{ animationDelay: '900ms' }} />

        <circle cx="280" cy="140" r="6.5" className="fill-ink" />
        <circle cx="720" cy="141" r="6.5" className="fill-gold stroke-paper" strokeWidth="2.5" />

        {/* The distance between the two outcomes */}
        <g className="animate-rise" style={{ animationDelay: '2100ms' }}>
          <line x1="880" y1="146" x2="880" y2="238" className="stroke-ink" strokeWidth="1.5" />
          <line x1="872" y1="146" x2="888" y2="146" className="stroke-ink" strokeWidth="1.5" />
          <line x1="872" y1="238" x2="888" y2="238" className="stroke-ink" strokeWidth="1.5" />
        </g>

        <g className="hidden fill-ink-soft font-sans text-[15px] sm:block">
          <text x="500" y="52" textAnchor="middle" className="fill-ink-faint">
            Market closed
          </text>
          <text x="280" y="338" textAnchor="middle">
            Friday close
          </text>
          <text x="720" y="338" textAnchor="middle">
            Monday open
          </text>
          <text x="268" y="118" textAnchor="end" className="fill-ink font-bold">
            Hedge opens
          </text>
          <text x="732" y="118" className="fill-gold-deep font-bold">
            Hedge closes
          </text>
          <text x="868" y="197" textAnchor="end" className="fill-ink font-bold">
            The fall you sat out
          </text>
        </g>
      </svg>
  )
}
