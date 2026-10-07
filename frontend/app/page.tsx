import type { Metadata } from 'next'
import Link from 'next/link'
import { GapChart } from '@/components/landing/gap-chart'
import { LiveSession } from '@/components/landing/live-session'
import { TryIt } from '@/components/landing/try-it'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = {
  title: 'ProX: protection for tokenized stocks while the market is closed',
  description: 'Hold your tokenized stock and hedge it for the hours the market is shut. ProX opens the hedge, watches it, and closes it once prices agree again.',
}

const STEPS = [
  {
    title: 'Choose what to protect',
    body: 'Pick a stock you hold on Backpack, how much of it to cover, and for how long: after hours, four hours, the weekend, or a time you set.',
  },
  {
    title: 'ProX opens a matching short',
    body: 'It sells the same stock’s perpetual on Backpack. Your stock stays where it is and serves as the collateral, so nothing is sold and no extra cash is needed.',
  },
  {
    title: 'It closes itself',
    body: 'When the window ends, an oracle on Chainlink compares the perpetual with the cash market. Once they agree several times in a row, the short is bought back and you get a receipt.',
  },
]

const SAFEGUARDS = [
  { title: 'The close can only reduce', body: 'The order that ends a hedge can shrink the short. It cannot turn it into a long position.' },
  { title: 'Margin is watched', body: 'Every few seconds ProX reads your margin from Backpack. If it tightens, the hedge is cut back and then closed, well before liquidation.' },
  { title: 'Prices are checked twice', body: 'The oracle’s readings must match what ProX sees itself. A reading that disagrees does not count.' },
  { title: 'Every result leaves a mark', body: 'The hash of each receipt is written to Solana, so the record can be checked against the chain later.' },
]

export default function LandingPage() {
  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 sm:px-8">
      <header className="flex items-center justify-between gap-4 py-5">
        <span className="font-heading text-[1.5rem] font-semibold tracking-[0.2px]">ProX</span>
        <Button nativeButton={false} render={<Link href="/app" />} variant="secondary" className="rounded-full">
          Open the app
        </Button>
      </header>

      <main>
        <section className="pt-10 pb-20 sm:pt-16">
          <h1 className="max-w-[15ch] font-heading text-[clamp(2.9rem,8.4vw,6.5rem)] leading-[0.98] font-medium tracking-[-0.025em]">The market closes. Your stock keeps moving.</h1>
          <div className="mt-8 grid items-end gap-x-14 gap-y-8 lg:grid-cols-[minmax(0,1fr)_auto]">
            <p className="max-w-[54ch] text-[1.15rem] leading-[1.6] text-ink-soft">
              Tokenized stocks trade around the clock, but the exchange they follow shuts every evening and all weekend. ProX hedges your position for exactly those hours, then removes the hedge once the market is open and prices agree.
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <Button nativeButton={false} render={<Link href="/app" />} size="lg" className="px-7">
                Open the app
              </Button>
              <a href="#how" className="font-bold text-ink">
                See how it works
              </a>
            </div>
          </div>
          <div className="mt-14">
            <GapChart />
          </div>
          <div className="mt-8">
            <LiveSession />
          </div>
        </section>

        <section className="border-t border-line py-20">
          <h2 className="max-w-[20ch] font-heading text-[clamp(2rem,5vw,3.4rem)] leading-[1.04] font-semibold tracking-[-0.02em]">Two positions that cancel out</h2>
          <p className="mt-5 mb-12 max-w-[58ch] text-[1.05rem] leading-[1.6] text-ink-soft">
            A short gains what the stock loses. Hold both in the same size and a move in the price leaves you where you started. Try a few.
          </p>
          <TryIt />
        </section>

        <section id="how" className="scroll-mt-8 border-t border-line py-20">
          <h2 className="font-heading text-[clamp(2rem,5vw,3.4rem)] leading-[1.04] font-semibold tracking-[-0.02em]">How it works</h2>
          <ol className="mt-12 grid gap-x-12 gap-y-12 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <span className="font-heading text-[4.5rem] leading-none font-medium text-gold" aria-hidden>
                  {i + 1}
                </span>
                <h3 className="mt-4 font-heading text-[1.6rem] leading-tight font-semibold tracking-[-0.3px]">{step.title}</h3>
                <p className="mt-3 leading-[1.65] text-ink-soft">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-t border-line py-20">
          <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div>
              <h2 className="font-heading text-[clamp(2rem,5vw,3.4rem)] leading-[1.04] font-semibold tracking-[-0.02em]">What keeps it safe</h2>
              <p className="mt-5 max-w-[40ch] text-[1.05rem] leading-[1.6] text-ink-soft">A hedge is a real position on a real exchange. These are the limits ProX works inside.</p>
            </div>
            <dl className="grid gap-x-12 sm:grid-cols-2">
              {SAFEGUARDS.map((item) => (
                <div key={item.title} className="border-t border-line py-6">
                  <dt className="text-[1.05rem] font-bold">{item.title}</dt>
                  <dd className="mt-2 leading-[1.65] text-ink-soft">{item.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="border-t border-line py-24 text-center">
          <h2 className="mx-auto max-w-[18ch] font-heading text-[clamp(2.2rem,6vw,4rem)] leading-[1.02] font-medium tracking-[-0.02em]">Keep the stock. Sit out the gap.</h2>
          <Button nativeButton={false} render={<Link href="/app" />} size="lg" className="mt-9 px-8">
            Open the app
          </Button>
        </section>
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line py-8 text-sm text-ink-faint">
        <span>ProX. Built on Backpack, Solana and Chainlink CRE.</span>
        <span>A hedge has costs and can be liquidated. This is not investment advice.</span>
      </footer>
    </div>
  )
}
