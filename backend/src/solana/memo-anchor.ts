// Writes a hash of a record to Solana mainnet as a Memo transaction, so the receipt can be
// checked against the chain later. Failures are recorded, never thrown: anchoring must not
// stand between a hedge and its close.

import { createHash } from 'node:crypto'
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js'
import bs58 from 'bs58'
import type { FastifyBaseLogger } from 'fastify'
import type { Config } from '../config'
import type { PolicyRepo } from '../db/policies'
import type { Anchor, AnchorKind } from '../db/types'

// SPL Memo program, the same on every cluster.
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')
// A memo costs the base fee of 5,000 lamports. Stop anchoring rather than drain the key below 0.001 SOL.
const MIN_BALANCE_LAMPORTS = 1_000_000

export class MemoAnchor {
  private readonly connection: Connection
  readonly payer: Keypair

  constructor(
    rpcUrl: string,
    secretKey: string,
    private readonly policies: PolicyRepo,
    private readonly log: FastifyBaseLogger,
  ) {
    this.connection = new Connection(rpcUrl, 'confirmed')
    this.payer = parseKeypair(secretKey)
  }

  static fromConfig(config: Config, policies: PolicyRepo, log: FastifyBaseLogger): MemoAnchor | null {
    if (!config.SOLANA_PRIVATE_KEY) return null
    return new MemoAnchor(config.SOLANA_RPC_URL, config.SOLANA_PRIVATE_KEY, policies, log)
  }

  /** Hashes `record`, writes `prox:v1:<kind>:<policy>:<sha256>` on chain and stores the result. */
  async anchor(policyId: string, kind: AnchorKind, record: unknown): Promise<Anchor> {
    const digest = digestOf(record)
    const memo = `prox:v1:${kind}:${policyId}:${digest}`
    const pending = await this.policies.saveAnchor({ policyId, kind, digest, memo, status: 'PENDING', signature: null, error: null })
    try {
      const balance = await this.connection.getBalance(this.payer.publicKey)
      if (balance < MIN_BALANCE_LAMPORTS) {
        return this.policies.saveAnchor({ ...pending, status: 'SKIPPED', error: `payer balance ${balance} lamports is below the floor` })
      }
      const tx = new Transaction().add(new TransactionInstruction({ keys: [], programId: MEMO_PROGRAM_ID, data: Buffer.from(memo, 'utf8') }))
      const signature = await sendAndConfirmTransaction(this.connection, tx, [this.payer], { commitment: 'confirmed' })
      this.log.info({ policyId, kind, signature }, 'anchored on Solana')
      return this.policies.saveAnchor({ ...pending, status: 'CONFIRMED', signature, error: null })
    } catch (error) {
      this.log.error({ policyId, kind, err: error }, 'Solana anchor failed')
      return this.policies.saveAnchor({ ...pending, status: 'FAILED', error: (error as Error).message })
    }
  }

  async balanceLamports(): Promise<number> {
    return this.connection.getBalance(this.payer.publicKey)
  }
}

/** sha256 over JSON with sorted keys, so the same record always hashes the same. */
export function digestOf(record: unknown): string {
  return createHash('sha256').update(canonical(record)).digest('hex')
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Accepts a base58 secret key (wallet export) or the JSON byte array solana-keygen writes. */
function parseKeypair(secret: string): Keypair {
  const bytes = secret.trim().startsWith('[') ? Uint8Array.from(JSON.parse(secret) as number[]) : bs58.decode(secret.trim())
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes)
  if (bytes.length === 32) return Keypair.fromSeed(bytes)
  throw new Error('SOLANA_PRIVATE_KEY must be a 64-byte secret key or a 32-byte seed')
}
