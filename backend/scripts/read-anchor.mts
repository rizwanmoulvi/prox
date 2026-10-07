import { Connection } from '@solana/web3.js'
import { loadConfig } from '../src/config'
const sig = process.argv[2]!
const conn = new Connection(loadConfig().SOLANA_RPC_URL, 'confirmed')
const tx = await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
console.log('slot', tx?.slot, 'fee lamports', tx?.meta?.fee, 'err', tx?.meta?.err)
console.log(tx?.meta?.logMessages?.filter((l) => l.includes('Memo (len')).join('\n'))
