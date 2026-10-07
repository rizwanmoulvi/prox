import { AccountApi } from './account'
import { BackpackSigner } from './auth'
import { CapitalApi } from './capital'
import { BackpackClient } from './client'
import { CollateralApi } from './collateral'
import { MarketsApi } from './markets'
import { OrdersApi } from './orders'
import { PositionsApi } from './positions'
import { StocksApi } from './stocks'

export * from './account'
export * from './auth'
export * from './capital'
export * from './client'
export * from './collateral'
export * from './markets'
export * from './orders'
export * from './positions'
export * from './stocks'
export * from './websocket'

/** Every Backpack endpoint the app uses, behind one object. */
export class Backpack {
  readonly account: AccountApi
  readonly capital: CapitalApi
  readonly collateral: CollateralApi
  readonly markets: MarketsApi
  readonly orders: OrdersApi
  readonly positions: PositionsApi
  readonly stocks: StocksApi

  constructor(readonly client: BackpackClient) {
    this.account = new AccountApi(client)
    this.capital = new CapitalApi(client)
    this.collateral = new CollateralApi(client)
    this.markets = new MarketsApi(client)
    this.orders = new OrdersApi(client)
    this.positions = new PositionsApi(client)
    this.stocks = new StocksApi(client)
  }

  /** Without keys only the public endpoints work. */
  static create(apiKey?: string, privateKey?: string): Backpack {
    const signer = apiKey && privateKey ? new BackpackSigner(apiKey, privateKey) : null
    return new Backpack(new BackpackClient(signer))
  }
}
