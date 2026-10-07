// The product in one line: what the stock did, what the hedge did, what it cost, what is left.

import { signedMoney } from '@/lib/format'

export function ResultEquation({ stock, hedge, costs, net }: { stock: number; hedge: number; costs: number; net: number }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1.2fr] sm:items-end">
      <Term label="Your stock" value={signedMoney(stock)} tone={stock < 0 ? 'down' : 'plain'} />
      <Operator>+</Operator>
      <Term label="The hedge" value={signedMoney(hedge)} />
      <Operator>&minus;</Operator>
      <Term label="Fees and funding" value={signedMoney(Math.abs(costs)).replace('+', '')} />
      <Operator>=</Operator>
      <Term label="Net result" value={signedMoney(net)} tone="result" />
    </dl>
  )
}

function Term({ label, value, tone = 'plain' }: { label: string; value: string; tone?: 'plain' | 'down' | 'result' }) {
  return (
    <div>
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd
        className={`mt-1 font-heading leading-none font-medium tracking-[-0.5px] ${tone === 'result' ? 'text-[clamp(2.4rem,7vw,3.4rem)] text-gold-deep' : 'text-[clamp(1.8rem,5vw,2.4rem)]'} ${tone === 'down' ? 'text-danger' : ''}`}
      >
        {value}
      </dd>
    </div>
  )
}

function Operator({ children }: { children: React.ReactNode }) {
  return (
    <span className="hidden pb-1 font-heading text-[1.8rem] leading-none text-ink-faint sm:block" aria-hidden>
      {children}
    </span>
  )
}
