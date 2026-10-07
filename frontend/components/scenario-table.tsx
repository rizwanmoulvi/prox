// What a price move does to the position with and without the hedge. Worked from the numbers
// on screen; fees and funding are left out and said to be.

import { signedMoney } from '@/lib/format'
import { outcome } from '@/lib/hedge'

const MOVES = [-10, -5, 5, 10]

export function ScenarioTable({ ticker, stockValue, hedgeNotional }: { ticker: string; stockValue: number; hedgeNotional: number }) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Result of a price move with and without the hedge</caption>
      <thead>
        <tr className="text-left text-[0.76rem] text-ink-faint">
          <th scope="col" className="pb-2 font-normal">If {ticker} moves</th>
          <th scope="col" className="pb-2 text-right font-normal">Without ProX</th>
          <th scope="col" className="pb-2 text-right font-normal">With this hedge</th>
        </tr>
      </thead>
      <tbody>
        {MOVES.map((move) => {
          const result = outcome(stockValue, hedgeNotional, move)
          return (
            <tr key={move} className="border-t border-line-soft">
              <th scope="row" className="py-2 text-left font-normal text-ink-soft">
                {move > 0 ? '+' : ''}
                {move}%
              </th>
              <td className={`py-2 text-right font-mono text-[0.85rem] ${result.stock < 0 ? 'text-danger' : ''}`}>{signedMoney(result.stock)}</td>
              <td className="py-2 text-right font-mono text-[0.85rem] font-medium">{signedMoney(result.net)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
