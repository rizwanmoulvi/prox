// ED25519 request signing for the Backpack API (docs.backpack.exchange, "Signing requests").

import nacl from 'tweetnacl'

export type SigningParams = Record<string, string | number | boolean | undefined | null>

export const DEFAULT_WINDOW_MS = 5000

export class BackpackSigner {
  readonly apiKey: string
  private readonly secretKey: Uint8Array

  /** Both values are base64: the public verifying key and the 32-byte private seed. */
  constructor(apiKey: string, privateKey: string) {
    const seed = Buffer.from(privateKey, 'base64')
    if (seed.length !== 32 && seed.length !== 64) {
      throw new Error('BACKPACK_PRIVATE_KEY must be a base64 ED25519 seed (32 bytes)')
    }
    const pair = nacl.sign.keyPair.fromSeed(seed.subarray(0, 32))
    if (Buffer.from(pair.publicKey).toString('base64') !== apiKey) {
      throw new Error('BACKPACK_API_KEY is not the public key of BACKPACK_PRIVATE_KEY')
    }
    this.apiKey = apiKey
    this.secretKey = pair.secretKey
  }

  sign(instruction: string, params: SigningParams, timestamp: number, window = DEFAULT_WINDOW_MS): string {
    const message = Buffer.from(signingString(instruction, params, timestamp, window))
    return Buffer.from(nacl.sign.detached(message, this.secretKey)).toString('base64')
  }
}

/** instruction=<name>&<params sorted by key>&timestamp=<ms>&window=<ms> */
export function signingString(instruction: string, params: SigningParams, timestamp: number, window: number): string {
  const pairs = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null)
    .sort()
    .map((key) => `${key}=${params[key]}`)
  return [`instruction=${instruction}`, ...pairs, `timestamp=${timestamp}`, `window=${window}`].join('&')
}
