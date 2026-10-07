import { z } from 'zod'
import type { BackpackClient } from './client'

const CollateralAssetSchema = z.looseObject({
  symbol: z.string(),
  assetMarkPrice: z.string(),
  totalQuantity: z.string(),
  balanceNotional: z.string(),
  collateralWeight: z.string(),
  collateralValue: z.string(),
  availableQuantity: z.string(),
  lendQuantity: z.string(),
  openOrderQuantity: z.string(),
})
export type CollateralAsset = z.infer<typeof CollateralAssetSchema>

// The margin fractions are null when the account carries no exposure.
const CollateralSchema = z.looseObject({
  assetsValue: z.string(),
  borrowLiability: z.string(),
  liabilitiesValue: z.string(),
  netEquity: z.string(),
  netEquityAvailable: z.string(),
  netEquityLocked: z.string(),
  netExposureFutures: z.string(),
  pnlUnrealized: z.string(),
  unsettledEquity: z.string().nullish(),
  imf: z.string().nullish(),
  mmf: z.string().nullish(),
  marginFraction: z.string().nullish(),
  collateral: z.array(CollateralAssetSchema),
})
export type Collateral = z.infer<typeof CollateralSchema>

export class CollateralApi {
  constructor(private readonly client: BackpackClient) {}

  /** Account margin state and the collateral value of every asset held. */
  async get(): Promise<Collateral> {
    return CollateralSchema.parse(await this.client.signed('GET', '/api/v1/capital/collateral', 'collateralQuery'))
  }
}
