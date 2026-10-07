import { Connection } from '@solana/web3.js'
import { loadConfig } from '../src/config'
import { Db } from '../src/db/db'
import { PolicyRepo } from '../src/db/policies'
import { MemoAnchor, digestOf } from '../src/solana/memo-anchor'
const config = loadConfig()
const db = new Db(config.DATABASE_URL)
const policies = new PolicyRepo(db)
const log = { info: (o: unknown, m: string) => console.log(m, o), error: (o: unknown, m: string) => console.error(m, o) } as any
const anchor = MemoAnchor.fromConfig(config, policies, log)!
console.log('payer', anchor.payer.publicKey.toBase58(), 'balance SOL', (await anchor.balanceLamports()) / 1e9)
const policyId = '3cc4226d-61af-49be-b9c9-115069a63b1a'
const { policy } = (await policies.get(policyId))!
const result = await anchor.anchor(policyId, 'RECEIPT', policy.receipt)
console.log('anchor row', { kind: result.kind, status: result.status, digest: result.digest, signature: result.signature, error: result.error })
if (result.signature) {
  const conn = new Connection(config.SOLANA_RPC_URL, 'confirmed')
  const tx = await conn.getTransaction(result.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
  const memoLog = tx?.meta?.logMessages?.find((l) => l.includes('Memo'))
  console.log('on-chain memo log:', memoLog)
  console.log('memo matches digest:', memoLog?.includes(digestOf(policy.receipt)))
  console.log('explorer: https://explorer.solana.com/tx/' + result.signature)
  console.log('balance after SOL', (await anchor.balanceLamports()) / 1e9)
}
await db.close()
