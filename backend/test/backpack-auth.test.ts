import nacl from 'tweetnacl'
import { describe, expect, it } from 'vitest'
import { BackpackSigner, signingString } from '../src/backpack/auth'

describe('signingString', () => {
  // The worked example in the Backpack docs, "Signing requests".
  it('reproduces the order cancel example from the Backpack docs', () => {
    expect(signingString('orderCancel', { orderId: 28, symbol: 'BTC_USDT' }, 1614550000000, 5000)).toBe(
      'instruction=orderCancel&orderId=28&symbol=BTC_USDT&timestamp=1614550000000&window=5000',
    )
  })

  // The private stream example in the Backpack docs, "Websocket streams, Private".
  it('reproduces the subscribe example from the Backpack docs', () => {
    expect(signingString('subscribe', {}, 1614550000000, 5000)).toBe(
      'instruction=subscribe&timestamp=1614550000000&window=5000',
    )
  })

  it('orders parameters alphabetically and writes booleans as true and false', () => {
    const params = { symbol: 'NVDA.US_USDC_PERP', side: 'Ask', reduceOnly: false, quantity: '0.01', clientId: 7 }
    expect(signingString('orderExecute', params, 1, 5000)).toBe(
      'instruction=orderExecute&clientId=7&quantity=0.01&reduceOnly=false&side=Ask&symbol=NVDA.US_USDC_PERP&timestamp=1&window=5000',
    )
  })

  it('leaves out parameters that have no value', () => {
    expect(signingString('positionQuery', { symbol: undefined }, 1, 5000)).toBe('instruction=positionQuery&timestamp=1&window=5000')
  })
})

describe('BackpackSigner', () => {
  const pair = nacl.sign.keyPair()
  const apiKey = Buffer.from(pair.publicKey).toString('base64')
  const seed = Buffer.from(pair.secretKey.subarray(0, 32)).toString('base64')

  it('produces a signature the public key verifies over the signing string', () => {
    const signature = new BackpackSigner(apiKey, seed).sign('accountQuery', {}, 1614550000000)
    const message = Buffer.from('instruction=accountQuery&timestamp=1614550000000&window=5000')
    expect(nacl.sign.detached.verify(message, Buffer.from(signature, 'base64'), pair.publicKey)).toBe(true)
  })

  it('refuses a private key that does not belong to the API key', () => {
    const other = Buffer.from(nacl.sign.keyPair().secretKey.subarray(0, 32)).toString('base64')
    expect(() => new BackpackSigner(apiKey, other)).toThrow(/not the public key/)
  })

  it('refuses a private key of the wrong length', () => {
    expect(() => new BackpackSigner(apiKey, Buffer.from('short').toString('base64'))).toThrow(/32 bytes/)
  })
})
