// Checks a CRE report the way the Keystone forwarder would: recover each signer from
// keccak256(keccak256(rawReport) || reportContext) and require f+1 of the DON's registered
// signers. Follows docs.chain.link/cre "Verifying CRE Reports Offchain".

import { concatHex, createPublicClient, hexToBytes, http, keccak256, recoverAddress, toHex, type Hex, type PublicClient } from 'viem'
import { mainnet } from 'viem/chains'

export const REPORT_HEADER_LENGTH = 109
const CAPABILITY_REGISTRY = '0x76c9cf548b4179F8901cda1f8623568b58215E62' as const

export interface ReportHeader {
  donId: number
  workflowId: Hex
  workflowOwner: Hex
  body: Uint8Array
}

export interface SignedReportJson {
  report: string
  context: string
  signatures: string[]
}

export function parseHeader(rawReport: Uint8Array): ReportHeader {
  if (rawReport.length < REPORT_HEADER_LENGTH) throw new Error(`rawReport too short: ${rawReport.length} bytes`)
  const view = new DataView(rawReport.buffer, rawReport.byteOffset)
  return {
    donId: view.getUint32(37, false),
    workflowId: toHex(rawReport.slice(45, 77)),
    workflowOwner: toHex(rawReport.slice(87, 107)),
    body: rawReport.slice(REPORT_HEADER_LENGTH),
  }
}

export function reportHash(rawReport: Uint8Array): Hex {
  return keccak256(toHex(rawReport))
}

function signedDigest(rawReport: Uint8Array, reportContext: Uint8Array): Hex {
  return keccak256(concatHex([keccak256(toHex(rawReport)), toHex(reportContext)]))
}

export class ReportVerifier {
  private readonly client: PublicClient
  private readonly signerCache = new Map<number, { f: number; signers: Set<string> }>()

  constructor(ethMainnetRpcUrl: string) {
    this.client = createPublicClient({ chain: mainnet, transport: http(ethMainnetRpcUrl) })
  }

  /** Number of valid signatures from registered signers. Throws when fewer than f+1. */
  async verify(rawReport: Uint8Array, reportContext: Uint8Array, signatures: Uint8Array[]): Promise<number> {
    const { donId } = parseHeader(rawReport)
    const { f, signers } = await this.fetchSigners(donId)
    const digest = signedDigest(rawReport, reportContext)
    let valid = 0
    for (const signature of signatures) {
      if (signature.length !== 65) continue
      const normalized = new Uint8Array(signature)
      if (normalized[64]! >= 27) normalized[64]! -= 27
      try {
        const recovered = await recoverAddress({ hash: digest, signature: toHex(normalized) })
        if (signers.has(recovered.toLowerCase().slice(2))) valid++
      } catch {
        // malformed signature: skip
      }
    }
    if (valid < f + 1) throw new Error(`insufficient valid signatures: ${valid}/${f + 1}`)
    return valid
  }

  /** getDON(donId) then getNodesByP2PIds, decoded by hand from the ABI words. Cached per DON. */
  private async fetchSigners(donId: number): Promise<{ f: number; signers: Set<string> }> {
    const cached = this.signerCache.get(donId)
    if (cached) return cached
    const donIdWord = new Uint8Array(32)
    new DataView(donIdWord.buffer).setUint32(28, donId, false)
    const don = await this.call(concatHex(['0x23537405', toHex(donIdWord)]))
    if (don.length < 224) throw new Error('getDON response too short')
    const f = readWord(don, 96)
    const idsPtr = readWord(don, 192)
    const countOffset = 32 + idsPtr
    const count = readWord(don, countOffset)
    const nodeIds: Hex[] = []
    for (let i = 0; i < count; i++) nodeIds.push(toHex(don.slice(countOffset + 32 + i * 32, countOffset + 64 + i * 32)))
    if (!count) return this.remember(donId, f, new Set())

    const ptr = new Uint8Array(32)
    new DataView(ptr.buffer).setUint32(28, 32, false)
    const countWord = new Uint8Array(32)
    new DataView(countWord.buffer).setUint32(28, count, false)
    const nodes = await this.call(concatHex(['0x05a51966', toHex(ptr), toHex(countWord), ...nodeIds]))
    const outer = readWord(nodes, 0)
    const returned = readWord(nodes, outer)
    const signers = new Set<string>()
    for (let i = 0; i < returned; i++) {
      const elementPtr = readWord(nodes, outer + 32 + i * 32)
      const tuple = outer + 32 + elementPtr
      if (tuple + 288 > nodes.length) break
      signers.add(toHex(nodes.slice(tuple + 96, tuple + 116)).slice(2).toLowerCase())
    }
    return this.remember(donId, f, signers)
  }

  private remember(donId: number, f: number, signers: Set<string>) {
    const entry = { f, signers }
    this.signerCache.set(donId, entry)
    return entry
  }

  private async call(data: Hex): Promise<Uint8Array> {
    const result = await this.client.call({ to: CAPABILITY_REGISTRY, data })
    if (!result.data) throw new Error('empty response from the capability registry')
    return hexToBytes(result.data)
  }
}

/** The low 4 bytes of a 32-byte ABI word. */
function readWord(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset + 28, 4).getUint32(0, false)
}
