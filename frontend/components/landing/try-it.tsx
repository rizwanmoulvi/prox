'use client'

// A worked example the visitor can push around: pick a move and a level, see the three numbers.

import { useState } from 'react'
import { signedMoney } from '@/lib/format'
import { outcome } from '@/lib/hedge'

const POSITION = 1000
const LEVELS = [25, 50, 75, 100]
const SCALE = 200 // dollars at which a bar reaches full width

export function TryIt() {
  const [move, setMove] = useState(-8)
  const [level, setLevel] = useState(100)
  const result = outcome(POSITION, (POSITION * level) / 100, move)
  const unhedged = outcome(POSITION, 0, move)

  return (
    <div className="grid gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="flex flex-col gap-8">
        <div>
          <label htmlFor="move" className="flex items-baseline justify-between gap-4">
            <span className="text-ink-soft">While the market is shut, the stock moves</span>
            <span className="font-heading text-[2rem] leading-none font-medium tracking-[-0.4px]">
              {move > 0 ? '+' : ''}
              {move}%
            </span>
          </label>
          <input
            id="move"
            type="range"
            min={-20}
            max={20}
            step={1}
            value={move}
            onChange={(e) => setMove(Number(e.target.value))}
            className="mt-4 h-8 w-full cursor-pointer accent-[var(--ink)]"
          />
          <div className="flex justify-between text-[0.8rem] text-ink-faint">
            <span>-20%</span>
            <span>0</span>
            <span>+20%</span>
          </div>
        </div>
        <fieldset>
          <legend className="text-ink-soft">You protected</legend>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {LEVELS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={level === value}
                onClick={() => setLevel(value)}
                className={`cursor-pointer rounded-lg py-3 font-bold transition-[scale,background-color,color,box-shadow] duration-150 ease-out-strong active:scale-[0.97] ${
                  level === value ? 'bg-ink text-paper' : 'shadow-[inset_0_0_0_1.5px_var(--line)] hover:shadow-[inset_0_0_0_1.5px_var(--ink)]'
                }`}
              >
                {value}%
              </button>
            ))}
          </div>
        </fieldset>
        <p className="text-sm leading-relaxed text-ink-faint">An example on a $1,000 position, before fees and funding.</p>
      </div>

      <div className="flex flex-col justify-center gap-5" aria-live="polite">
        <Bar label="Your stock" value={result.stock} tone="stock" />
        <Bar label="The hedge" value={result.hedge} tone="hedge" />
        <div className="border-t border-line pt-5">
          <Bar label="You end up" value={result.net} tone="net" large />
        </div>
        <p className="leading-relaxed text-ink-soft">
          {result.net === unhedged.net
            ? 'With nothing protected you take the whole move.'
            : move === 0
              ? 'No move, so nothing to offset. The hedge only cost its fees.'
              : move < 0
                ? `Without the hedge you would be down ${signedMoney(unhedged.net).replace('-', '')}.`
                : `The hedge gives up the same share of a rise. Without it you would be up ${signedMoney(unhedged.net).replace('+', '')}.`}
        </p>
      </div>
    </div>
  )
}

function Bar({ label, value, tone, large }: { label: string; value: number; tone: 'stock' | 'hedge' | 'net'; large?: boolean }) {
  const share = Math.min(1, Math.abs(value) / SCALE)
  const colour = tone === 'hedge' ? 'bg-gold' : tone === 'stock' && value < 0 ? 'bg-danger' : 'bg-ink'
  return (
    <div className="grid grid-cols-[6.5rem_1fr_5.5rem] items-center gap-3 sm:grid-cols-[7.5rem_1fr_6.5rem]">
      <span className={large ? 'font-bold' : 'text-ink-soft'}>{label}</span>
      <span className="relative h-3" aria-hidden>
        <span className="absolute inset-y-[-6px] left-1/2 w-px bg-line" />
        <span
          className={`absolute inset-y-0 w-1/2 rounded-full transition-transform duration-200 ease-out-strong ${colour} ${value < 0 ? 'right-1/2 origin-right' : 'left-1/2 origin-left'}`}
          style={{ transform: `scaleX(${share})` }}
        />
      </span>
      <span className={`text-right font-mono ${large ? 'text-[1.15rem] font-medium' : ''}`}>{signedMoney(value)}</span>
    </div>
  )
}
