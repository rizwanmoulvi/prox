// Receives the signed convergence report the CRE workflow POSTs, checks it, stores it once and
// hands it to the convergence engine.

import { decodeOracleReport, type OracleReport } from '@prox/core'
import { hexToBytes, toHex } from 'viem'
import type { Context } from '../context'
import type { ConvergenceService } from '../convergence/convergence.service'
import type { Attestation, AttestationMode } from '../db/types'
import { parseHeader, reportHash, ReportVerifier, type SignedReportJson } from './report-verifier'

export class IngestRejected extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'IngestRejected'
  }
}

export interface IngestSource {
  ip: string
  token: string | undefined
}

export class ReportIngest {
  private readonly verifier: ReportVerifier | null

  constructor(
    private readonly ctx: Context,
    private readonly convergence: ConvergenceService,
  ) {
    const { CRE_REPORT_MODE, ETH_MAINNET_RPC_URL } = ctx.config
    this.verifier = CRE_REPORT_MODE === 'don' ? new ReportVerifier(ETH_MAINNET_RPC_URL!) : null
  }

  /** Returns the stored attestation, or null when this exact report was already processed. */
  async ingest(body: SignedReportJson, source: IngestSource): Promise<Attestation | null> {
    const rawReport = hexToBytes(withPrefix(body.report))
    const context = hexToBytes(withPrefix(body.context))
    const signatures = body.signatures.map((s) => hexToBytes(withPrefix(s)))
    const header = parseHeader(rawReport)
    const { mode, validSignatures } = await this.authenticate(rawReport, context, signatures, header.workflowId, source)

    const report = decodeOracleReport(toHex(header.body))
    const stored = await this.ctx.attestations.insert({
      reportHash: reportHash(rawReport),
      mode,
      rawReport: body.report,
      context: body.context,
      signatures: body.signatures,
      validSignatures,
      workflowId: header.workflowId,
      workflowOwner: header.workflowOwner,
      observedAt: new Date(Number(report.observedAtMs)),
      payload: serializable(report),
    })
    if (!stored) return null
    this.ctx.log.info({ hash: stored.reportHash, mode, observations: report.observations.length }, 'CRE report accepted')
    await this.convergence.onAttestation(stored, report)
    this.ctx.events.publish('oracle.report', { hash: stored.reportHash, mode, payload: stored.payload })
    return stored
  }

  /**
   * don mode: f+1 signatures from the registered DON and the expected workflow id.
   * simulation mode: the local simulator's reports carry test-key signatures, so only the loopback
   * runner with the shared token is accepted and the result is labelled as such.
   */
  private async authenticate(
    rawReport: Uint8Array,
    context: Uint8Array,
    signatures: Uint8Array[],
    workflowId: string,
    source: IngestSource,
  ): Promise<{ mode: AttestationMode; validSignatures: number }> {
    if (this.verifier) {
      if (workflowId.toLowerCase() !== this.ctx.config.CRE_WORKFLOW_ID!.toLowerCase()) {
        throw new IngestRejected(403, `report is from workflow ${workflowId}, not ${this.ctx.config.CRE_WORKFLOW_ID}`)
      }
      try {
        return { mode: 'DON', validSignatures: await this.verifier.verify(rawReport, context, signatures) }
      } catch (error) {
        throw new IngestRejected(403, (error as Error).message)
      }
    }
    if (!isLoopback(source.ip)) throw new IngestRejected(403, 'simulation reports are accepted from this machine only')
    if (source.token !== this.ctx.config.CRE_INGEST_TOKEN) throw new IngestRejected(401, 'bad ingest token')
    return { mode: 'SIMULATION', validSignatures: 0 }
  }
}

function withPrefix(hex: string): `0x${string}` {
  return (hex.startsWith('0x') ? hex : `0x${hex}`) as `0x${string}`
}

function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}

/** bigint fields as strings so the payload fits in JSONB and in the API. */
export function serializable(report: OracleReport): Record<string, unknown> {
  return JSON.parse(JSON.stringify(report, (_, value) => (typeof value === 'bigint' ? value.toString() : value))) as Record<string, unknown>
}
