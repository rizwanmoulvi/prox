// Runtime configuration, read once from backend/.env. Trading limits have no defaults on
// purpose: the operator states them, the code does not assume them.

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const flag = z.enum(['true', 'false']).transform((v) => v === 'true')
const fraction = z.coerce.number().gt(0).lt(1)
const list = z.string().transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().default(4000),
  FRONTEND_ORIGIN: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  /** Base58 wallet addresses allowed to sign in. */
  OPERATOR_WALLETS: list,

  BACKPACK_API_KEY: z.string().min(1),
  BACKPACK_PRIVATE_KEY: z.string().min(1),

  TRADING_ENABLED: flag,
  DEMO_MODE: flag,
  MAX_TOTAL_NOTIONAL_USD: z.coerce.number().positive(),
  MAX_POSITION_NOTIONAL_USD: z.coerce.number().positive(),
  MAX_APPLICATION_LEVERAGE: z.coerce.number().int().min(1).max(5),
  ALLOWED_SYMBOLS: list,
  /** Furthest an IOC limit order may price through the touch, in basis points. */
  MAX_SLIPPAGE_BPS: z.coerce.number().positive(),
  /** Share of initial margin kept free on top of the requirement. */
  MARGIN_BUFFER: fraction,

  MMR_WARNING: fraction,
  MMR_RISK: fraction,
  MMR_REDUCE: fraction,
  MMR_EMERGENCY: fraction,

  CONVERGENCE_BPS: z.coerce.number().positive(),
  CONVERGENCE_COUNT: z.coerce.number().int().positive(),
  /** Wait after the cash market reopens before convergence checks count. */
  REOPEN_COOLDOWN_SEC: z.coerce.number().int().nonnegative(),
  DEMO_COOLDOWN_SEC: z.coerce.number().int().nonnegative(),
  /** How long a policy may wait for convergence before it is closed anyway. */
  MAX_CONVERGENCE_WAIT_SEC: z.coerce.number().int().positive(),
  /** How far an oracle price may sit from the backend's own reading before the check is refused. */
  ORACLE_TOLERANCE_BPS: z.coerce.number().positive(),

  CRE_REPORT_MODE: z.enum(['simulation', 'don']),
  CRE_INGEST_TOKEN: z.string().min(24),
  CRE_PROJECT_DIR: z.string().optional(),
  CRE_WORKFLOW_NAME: z.string().default('convergence-oracle'),
  CRE_TARGET: z.string().default('staging-settings'),
  CRE_SIM_INTERVAL_SEC: z.coerce.number().int().min(30).default(30),
  /** Required in don mode: the workflow whose reports are trusted. */
  CRE_WORKFLOW_ID: z.string().optional(),
  ETH_MAINNET_RPC_URL: z.string().optional(),

  SOLANA_RPC_URL: z.string().default('https://api.mainnet-beta.solana.com'),
  /** Base58 secret key that pays for Memo anchors. Anchoring is off when it is absent. */
  SOLANA_PRIVATE_KEY: z.string().optional(),
})

export type Config = z.infer<typeof ConfigSchema>

export function loadConfig(): Config {
  const envFile = fileURLToPath(new URL('../.env', import.meta.url))
  if (existsSync(envFile)) process.loadEnvFile(envFile)
  // A key left blank in .env counts as not set.
  const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ''))
  const parsed = ConfigSchema.safeParse(env)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`backend/.env is incomplete or invalid:\n${problems}`)
  }
  return checkConsistency(parsed.data)
}

function checkConsistency(config: Config): Config {
  const ordered = config.MMR_WARNING < config.MMR_RISK && config.MMR_RISK < config.MMR_REDUCE && config.MMR_REDUCE < config.MMR_EMERGENCY
  if (!ordered) throw new Error('MMR thresholds must rise: WARNING < RISK < REDUCE < EMERGENCY')
  if (config.MAX_POSITION_NOTIONAL_USD > config.MAX_TOTAL_NOTIONAL_USD) {
    throw new Error('MAX_POSITION_NOTIONAL_USD cannot exceed MAX_TOTAL_NOTIONAL_USD')
  }
  if (config.CRE_REPORT_MODE === 'don' && (!config.CRE_WORKFLOW_ID || !config.ETH_MAINNET_RPC_URL)) {
    throw new Error('CRE_REPORT_MODE=don needs CRE_WORKFLOW_ID and ETH_MAINNET_RPC_URL')
  }
  return config
}

export function riskThresholds(config: Config) {
  return {
    warning: config.MMR_WARNING,
    risk: config.MMR_RISK,
    reduce: config.MMR_REDUCE,
    emergency: config.MMR_EMERGENCY,
  }
}
