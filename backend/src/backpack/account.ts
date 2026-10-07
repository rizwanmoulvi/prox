import { z } from 'zod'
import type { BackpackClient } from './client'

const AccountSchema = z.looseObject({
  leverageLimit: z.string(),
  futuresMakerFee: z.string(),
  futuresTakerFee: z.string(),
  liquidating: z.boolean(),
  autoBorrowSettlements: z.boolean(),
  autoRealizePnl: z.boolean(),
  autoRepayBorrows: z.boolean(),
  borrowLimit: z.string().nullish(),
  positionLimit: z.string().nullish(),
})
export type Account = z.infer<typeof AccountSchema>

export class AccountApi {
  constructor(private readonly client: BackpackClient) {}

  async get(): Promise<Account> {
    return AccountSchema.parse(await this.client.signed('GET', '/api/v1/account', 'accountQuery'))
  }

  /** Changes the account-wide maximum leverage. Backpack rejects it if open exposure would breach margin. */
  /** Callers read the account back to confirm: a 200 here has no documented body. */
  async setLeverageLimit(leverageLimit: string): Promise<void> {
    try {
      await this.client.signed('PATCH', '/api/v1/account', 'accountUpdate', { leverageLimit })
    } catch (error) {
      // Only a 2xx body reaches JSON.parse, so this is a success with a body that is not JSON.
      if (!(error instanceof SyntaxError)) throw error
    }
  }
}
