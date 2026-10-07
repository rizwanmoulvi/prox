// ProX convergence oracle. On every tick the DON reads, for each stock with a live protection,
// the Backpack perp mark price and the cash-market indicative quote, works out the basis and the
// session, signs the observations as a CRE report and POSTs it to the ProX backend.
// The Backpack API key never comes near this workflow: everything it reads is public.

import {
  ConsensusAggregationByFields,
  CronCapability,
  HTTPClient,
  Runner,
  consensusIdenticalAggregation,
  handler,
  hexToBase64,
  identical,
  median,
  ok,
  type CronPayload,
  type HTTPSendRequester,
  type Report,
  type Runtime,
} from '@chainlink/cre-sdk'
import type { HTTP_CLIENT_PB, SDK_PB } from '@chainlink/cre-sdk/pb'
import {
  basisCentiBps,
  encodeOracleReport,
  midE8,
  sessionAt,
  stateForSessionName,
  toE8,
  type OracleObservation,
  type SessionState,
  type StockHoliday,
  type StockSession,
} from '../../packages/core/src'
import { bytesToHex } from 'viem'

export type Config = {
  schedule: string
  backendUrl: string
  backpackApiUrl: string
}

export interface Pair {
  stockSymbol: string
  perpSymbol: string
}

/** What one node sees for one pair. Flat bigints so every field can be median-aggregated. */
export interface PairReading {
  perpMarkE8: bigint
  perpIndexE8: bigint
  stockBidE8: bigint
  stockAskE8: bigint
  quoteAvailable: bigint
  quoteTimestampMs: bigint
  sessionIndex: bigint
}

export interface SignedReportJson {
  report: string
  context: string
  signatures: string[]
  /** Set when no report was produced, with the reason. */
  skipped?: string
}

const SESSION_ORDER: SessionState[] = ['PREMARKET', 'REGULAR', 'POSTMARKET', 'OVERNIGHT', 'WEEKEND', 'HOLIDAY']
const INGEST_TOKEN_SECRET = 'PROX_INGEST_TOKEN'

export const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): SignedReportJson => {
  const http = new HTTPClient()
  const pairs = http.sendRequest(runtime, fetchWatchlist, consensusIdenticalAggregation<Pair[]>())(runtime.config).result()
  if (!pairs.length) return { report: '', context: '', signatures: [], skipped: 'no live protection to observe' }
  runtime.log(`Observing ${pairs.map((p) => p.stockSymbol).join(', ')}`)

  const observedAtMs = payload.scheduledExecutionTime
    ? BigInt(payload.scheduledExecutionTime.seconds) * 1000n
    : http.sendRequest(runtime, fetchServerTime, consensusIdenticalAggregation<bigint>())(runtime.config).result()

  const observations = pairs.map((pair) => {
    const reading = http.sendRequest(runtime, readPair, readingAggregation)(runtime.config, pair).result()
    return toObservation(pair, reading)
  })
  for (const o of observations) {
    runtime.log(`${o.stockSymbol}: perp ${o.perpMarkE8} ref ${o.referenceE8} basis ${o.basisCentiBps / 100} bps session ${o.session}`)
  }

  const encoded = encodeOracleReport({ observedAtMs, observations })
  const report = runtime
    .report({ encodedPayload: hexToBase64(encoded), encoderName: 'evm', signingAlgo: 'ecdsa', hashingAlgo: 'keccak256' })
    .result()
  const token = runtime.getSecret({ id: INGEST_TOKEN_SECRET }).result().value

  let signed: SignedReportJson = { report: '', context: '', signatures: [] }
  http
    .sendRequest(
      runtime,
      (requester: HTTPSendRequester) =>
        submitReport(requester, report, runtime.config, token, (json) => {
          signed = json
        }),
      consensusIdenticalAggregation<{ accepted: boolean }>(),
    )()
    .result()
  runtime.log('Report delivered to the ProX backend')
  return signed
}

export const initWorkflow = (config: Config) => {
  const cron = new CronCapability()
  return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>()
  await runner.run(initWorkflow)
}

// ---- node-level reads -----------------------------------------------------------------------

const fetchWatchlist = (requester: HTTPSendRequester, config: Config): Pair[] => {
  const body = getJson<{ pairs: Pair[] }>(requester, `${config.backendUrl}/api/cre/watchlist`)
  return body.pairs.map((p) => ({ stockSymbol: p.stockSymbol, perpSymbol: p.perpSymbol }))
}

const fetchServerTime = (requester: HTTPSendRequester, config: Config): bigint => {
  // Backpack's clock, rounded to the minute so every node agrees on it.
  const ms = getJson<number>(requester, `${config.backpackApiUrl}/api/v1/time`)
  return (BigInt(ms) / 60_000n) * 60_000n
}

export const readPair = (requester: HTTPSendRequester, config: Config, pair: Pair): PairReading => {
  const base = config.backpackApiUrl
  const marks = getJson<{ symbol: string; markPrice: string; indexPrice: string }[]>(requester, `${base}/api/v1/markPrices?symbol=${pair.perpSymbol}`)
  const mark = marks.find((m) => m.symbol === pair.perpSymbol)
  if (!mark) throw new Error(`no mark price for ${pair.perpSymbol}`)
  // One share is accepted in every session; "Ask" is what a seller gets, "Bid" what a buyer pays.
  const sell = getJson<IndicativeQuote>(requester, `${base}/api/v1/stockIndicativeQuote?symbol=${pair.stockSymbol}&side=Ask&quantity=1`)
  const buy = getJson<IndicativeQuote>(requester, `${base}/api/v1/stockIndicativeQuote?symbol=${pair.stockSymbol}&side=Bid&quantity=1`)
  const available = sell.available && buy.available
  const session = sell.session ?? buy.session
  const state: SessionState = session ? stateForSessionName(session) : computeSession(requester, base, sell.publishedAt)
  return {
    perpMarkE8: toE8(mark.markPrice),
    perpIndexE8: toE8(mark.indexPrice),
    stockBidE8: available ? toE8(sell.estimatedPrice ?? sell.price ?? '0') : 0n,
    stockAskE8: available ? toE8(buy.estimatedPrice ?? buy.price ?? '0') : 0n,
    quoteAvailable: available ? 1n : 0n,
    quoteTimestampMs: BigInt(sell.publishedAt),
    sessionIndex: BigInt(SESSION_ORDER.indexOf(state)),
  }
}

const readingAggregation = ConsensusAggregationByFields<PairReading>({
  perpMarkE8: median,
  perpIndexE8: median,
  stockBidE8: median,
  stockAskE8: median,
  quoteAvailable: median,
  quoteTimestampMs: median,
  sessionIndex: identical,
})

/** When the quoter names no session the market is closed: weekend or holiday, from the calendar. */
const computeSession = (requester: HTTPSendRequester, base: string, atMs: number): SessionState => {
  const sessions = getJson<StockSession[]>(requester, `${base}/api/v1/stockSessions`)
  const holidays = getJson<StockHoliday[]>(requester, `${base}/api/v1/stockHolidays`)
  return sessionAt(atMs, sessions, holidays).state
}

// Javy accepts only parameterless exported function declarations, so helpers are exported as consts.
export const toObservation = (pair: Pair, r: PairReading): OracleObservation => {
  const quoted = r.quoteAvailable === 1n && r.stockBidE8 > 0n && r.stockAskE8 > 0n
  const referenceE8 = quoted ? midE8(r.stockBidE8, r.stockAskE8) : r.perpIndexE8
  return {
    stockSymbol: pair.stockSymbol,
    perpSymbol: pair.perpSymbol,
    perpMarkE8: r.perpMarkE8,
    perpIndexE8: r.perpIndexE8,
    stockBidE8: quoted ? r.stockBidE8 : 0n,
    stockAskE8: quoted ? r.stockAskE8 : 0n,
    referenceE8,
    referenceSource: quoted ? 'INDICATIVE_QUOTE' : 'PERP_INDEX',
    basisCentiBps: Number(basisCentiBps(r.perpMarkE8, referenceE8)),
    session: SESSION_ORDER[Number(r.sessionIndex)] ?? 'HOLIDAY',
    quoteTimestampMs: r.quoteTimestampMs,
  }
}

// ---- report delivery -------------------------------------------------------------------------

type ReportResponse = SDK_PB.ReportResponse
type RequestJson = HTTP_CLIENT_PB.RequestJson

const submitReport = (
  requester: HTTPSendRequester,
  report: Report,
  config: Config,
  token: string,
  remember: (json: SignedReportJson) => void,
): { accepted: boolean } => {
  const format = (r: ReportResponse): RequestJson => {
    const json: SignedReportJson = {
      report: bytesToHex(r.rawReport).slice(2),
      context: bytesToHex(r.reportContext).slice(2),
      signatures: r.sigs.map((sig) => bytesToHex(sig.signature).slice(2)),
    }
    remember(json)
    return {
      url: `${config.backendUrl}/api/cre/reports`,
      method: 'POST',
      body: Buffer.from(new TextEncoder().encode(JSON.stringify(json))).toString('base64'),
      headers: { 'Content-Type': 'application/json', 'X-Prox-Ingest-Token': token },
      // Every node sends the same report; let the first delivery serve the rest.
      cacheSettings: { store: true, maxAge: '60s' },
    }
  }
  const response = requester.sendReport(report, format).result()
  if (!ok(response)) throw new Error(`backend refused the report: ${response.statusCode} ${new TextDecoder().decode(response.body)}`)
  return { accepted: true }
}

// ---- helpers ---------------------------------------------------------------------------------

interface IndicativeQuote {
  available: boolean
  session: string | null
  price?: string | null
  estimatedPrice?: string | null
  publishedAt: number
}

function getJson<T>(requester: HTTPSendRequester, url: string): T {
  const response = requester.sendRequest({ url, method: 'GET' }).result()
  if (!ok(response)) throw new Error(`${url} -> ${response.statusCode}`)
  return JSON.parse(new TextDecoder().decode(response.body)) as T
}
