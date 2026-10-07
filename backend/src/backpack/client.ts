// HTTP transport for the Backpack REST API: public calls, signed calls, clock sync and errors.

import { BackpackSigner, DEFAULT_WINDOW_MS, type SigningParams } from './auth'

export const BACKPACK_API_URL = 'https://api.backpack.exchange'

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

/** Backpack answered with an error. The request was not carried out. */
export class BackpackApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message)
    this.name = 'BackpackApiError'
  }
}

/** No answer arrived. For a mutating call the outcome is unknown and must be reconciled. */
export class BackpackTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackpackTimeoutError'
  }
}

export class BackpackClient {
  private clockOffsetMs = 0

  constructor(
    private readonly signer: BackpackSigner | null = null,
    private readonly baseUrl = BACKPACK_API_URL,
    private readonly timeoutMs = 10_000,
  ) {}

  /** Unsigned GET. Returns null for an empty 204 body. */
  async public<T>(path: string, query: SigningParams = {}): Promise<T> {
    return this.send<T>('GET', path + toQuery(query), {})
  }

  /** Signed request. GET sends params as the query string, other methods as a JSON body. */
  async signed<T>(method: Method, path: string, instruction: string, params: SigningParams = {}): Promise<T> {
    if (!this.signer) throw new Error('This Backpack client has no API key')
    const clean = dropEmpty(params)
    const timestamp = Date.now() + this.clockOffsetMs
    const headers: Record<string, string> = {
      'X-API-Key': this.signer.apiKey,
      'X-Signature': this.signer.sign(instruction, clean, timestamp),
      'X-Timestamp': String(timestamp),
      'X-Window': String(DEFAULT_WINDOW_MS),
    }
    if (method === 'GET') return this.send<T>(method, path + toQuery(clean), headers)
    headers['Content-Type'] = 'application/json; charset=utf-8'
    return this.send<T>(method, path, headers, JSON.stringify(clean))
  }

  /** Signed requests carry a timestamp Backpack checks, so follow its clock, not ours. */
  async syncClock(): Promise<number> {
    const before = Date.now()
    const serverTime = Number(await this.public<number | string>('/api/v1/time'))
    const after = Date.now()
    this.clockOffsetMs = Math.round(serverTime - (before + after) / 2)
    return this.clockOffsetMs
  }

  /** Signature fields for a private WebSocket subscription. */
  subscribeSignature(): [string, string, string, string] {
    if (!this.signer) throw new Error('This Backpack client has no API key')
    const timestamp = Date.now() + this.clockOffsetMs
    const signature = this.signer.sign('subscribe', {}, timestamp)
    return [this.signer.apiKey, signature, String(timestamp), String(DEFAULT_WINDOW_MS)]
  }

  private async send<T>(method: Method, pathAndQuery: string, headers: Record<string, string>, body?: string): Promise<T> {
    let response: Response
    try {
      response = await fetch(this.baseUrl + pathAndQuery, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new BackpackTimeoutError(`${method} ${pathAndQuery}: ${(error as Error).message}`)
    }
    const text = await response.text()
    if (!response.ok) throw toApiError(response.status, text, `${method} ${pathAndQuery}`)
    return (text ? JSON.parse(text) : null) as T
  }
}

function toApiError(status: number, text: string, label: string): BackpackApiError {
  try {
    const parsed = JSON.parse(text) as { code?: string; message?: string }
    return new BackpackApiError(status, parsed.code ?? null, `${label}: ${parsed.message ?? text}`)
  } catch {
    return new BackpackApiError(status, null, `${label}: ${text || `HTTP ${status}`}`)
  }
}

function dropEmpty(params: SigningParams): SigningParams {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null))
}

function toQuery(params: SigningParams): string {
  const entries = Object.entries(dropEmpty(params)).map(([key, value]): [string, string] => [key, String(value)])
  return entries.length ? `?${new URLSearchParams(entries)}` : ''
}
