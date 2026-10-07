// Until deploy access is granted, the oracle runs through `cre workflow simulate` on this machine.
// The runner fires it on a schedule while any protection is live. The workflow POSTs its report
// to the backend; if that does not reach us, the report in the CLI output is used instead.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '../context'
import type { ReportIngest } from './report-ingest'
import type { SignedReportJson } from './report-verifier'

const RUN_TIMEOUT_MS = 240_000

export class CreSimRunner {
  private timer: NodeJS.Timeout | null = null
  private running = false
  lastRun: { at: string; ok: boolean; detail: string } | null = null

  constructor(
    private readonly ctx: Context,
    private readonly ingest: ReportIngest,
    private readonly watchlist: () => Promise<unknown[]>,
  ) {}

  get enabled(): boolean {
    return this.ctx.config.CRE_REPORT_MODE === 'simulation' && !!this.ctx.config.CRE_PROJECT_DIR
  }

  start(): void {
    if (!this.enabled) return
    this.timer = setInterval(() => void this.tick(), this.ctx.config.CRE_SIM_INTERVAL_SEC * 1000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async tick(): Promise<void> {
    if (this.running) return
    if (!(await this.watchlist()).length) return
    this.running = true
    try {
      await this.runOnce()
    } catch (error) {
      this.lastRun = { at: new Date().toISOString(), ok: false, detail: (error as Error).message }
      this.ctx.log.error({ err: error }, 'CRE simulation failed')
    } finally {
      this.running = false
    }
  }

  /** One `cre workflow simulate` run. Resolves when the CLI exits. */
  async runOnce(): Promise<void> {
    const { CRE_PROJECT_DIR, CRE_WORKFLOW_NAME, CRE_TARGET } = this.ctx.config
    const args = ['workflow', 'simulate', CRE_WORKFLOW_NAME, '--non-interactive', '--trigger-index', '0', '--target', CRE_TARGET]
    const output = await run(creBinary(), args, CRE_PROJECT_DIR!)
    const ok = /Workflow Simulation Result/.test(output)
    // The ingest de-duplicates by report hash, so feeding the CLI output is harmless when the
    // workflow's own POST already arrived.
    const fromOutput = extractReport(output)
    const stored = fromOutput ? await this.ingest.ingest(fromOutput, { ip: '127.0.0.1', token: this.ctx.config.CRE_INGEST_TOKEN }) : null
    const detail = !ok ? output.slice(-800) : stored ? 'report taken from CLI output' : fromOutput ? 'report already received over HTTP' : 'ran without a report'
    this.lastRun = { at: new Date().toISOString(), ok, detail }
    this.ctx.log.info({ ok, detail }, 'CRE simulation run')
  }
}

function creBinary(): string {
  const local = join(homedir(), '.cre', 'bin', 'cre')
  return existsSync(local) ? local : 'cre'
}

function run(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // The CLI reads cre/.env itself; it does not get the backend's secrets.
    const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', USER: process.env.USER ?? '', TERM: 'dumb' }
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`cre simulate exceeded ${RUN_TIMEOUT_MS / 1000}s`))
    }, RUN_TIMEOUT_MS)
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(output)
      else reject(new Error(`cre exited with ${code}: ${output.slice(-1500)}`))
    })
  })
}

/** The workflow returns the signed report as its result; find it in the CLI output, whatever the key order. */
export function extractReport(output: string): SignedReportJson | null {
  const report = /"report"\s*:\s*"([0-9a-fA-F]+)"/.exec(output)?.[1]
  const context = /"context"\s*:\s*"([0-9a-fA-F]+)"/.exec(output)?.[1]
  const signatureList = /"signatures"\s*:\s*\[([^\]]*)\]/.exec(output)?.[1]
  if (!report || !context || signatureList === undefined) return null
  const signatures = [...signatureList.matchAll(/"([0-9a-fA-F]+)"/g)].map((m) => m[1]!)
  return { report, context, signatures }
}
