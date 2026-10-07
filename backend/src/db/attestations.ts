import type { Db } from './db'
import type { Attestation, ConvergenceCheck } from './types'

type NewAttestation = Omit<Attestation, 'id' | 'receivedAt'>
type NewCheck = Omit<ConvergenceCheck, 'id'>

export class AttestationRepo {
  constructor(private readonly db: Db) {}

  /** Stores a report once. Returns null when the same report was already received (nodes resend). */
  async insert(a: NewAttestation): Promise<Attestation | null> {
    return this.db.maybeOne<Attestation>(
      `INSERT INTO attestation (report_hash, mode, raw_report, context, signatures, valid_signatures, workflow_id, workflow_owner, observed_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (report_hash) DO NOTHING RETURNING *`,
      [
        a.reportHash,
        a.mode,
        a.rawReport,
        a.context,
        JSON.stringify(a.signatures),
        a.validSignatures,
        a.workflowId,
        a.workflowOwner,
        a.observedAt,
        JSON.stringify(a.payload),
      ],
    )
  }

  async byHash(reportHash: string): Promise<Attestation | null> {
    return this.db.maybeOne<Attestation>('SELECT * FROM attestation WHERE report_hash = $1', [reportHash])
  }

  async latest(limit = 20): Promise<Attestation[]> {
    return this.db.query<Attestation>('SELECT * FROM attestation ORDER BY id DESC LIMIT $1', [limit])
  }

  async addCheck(check: NewCheck): Promise<ConvergenceCheck> {
    return this.db.one<ConvergenceCheck>(
      `INSERT INTO convergence_check (policy_id, attestation_id, observed_at, basis_bps, session, passed, counted, reject_reason, count_after)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [check.policyId, check.attestationId, check.observedAt, check.basisBps, check.session, check.passed, check.counted, check.rejectReason, check.countAfter],
    )
  }

  async checksFor(policyId: string, limit = 200): Promise<ConvergenceCheck[]> {
    return this.db.query<ConvergenceCheck>(
      'SELECT * FROM (SELECT * FROM convergence_check WHERE policy_id = $1 ORDER BY id DESC LIMIT $2) recent ORDER BY id',
      [policyId, limit],
    )
  }

  /** The checks that counted towards the current streak, newest first. */
  async countedChecks(policyId: string, limit: number): Promise<ConvergenceCheck[]> {
    return this.db.query<ConvergenceCheck>(
      'SELECT * FROM convergence_check WHERE policy_id = $1 AND counted ORDER BY id DESC LIMIT $2',
      [policyId, limit],
    )
  }
}
