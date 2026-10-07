import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AttestationRepo } from '../../src/db/attestations'
import { Db } from '../../src/db/db'
import { OrderRepo } from '../../src/db/orders'
import { PolicyRepo, StateConflictError } from '../../src/db/policies'

// Exercises the SQL against the configured database. Rows it creates are removed afterwards.
const url = process.env.DATABASE_URL ?? readEnvUrl()

function readEnvUrl(): string | undefined {
  try {
    process.loadEnvFile(new URL('../../.env', import.meta.url))
  } catch {
    return undefined
  }
  return process.env.DATABASE_URL || undefined
}

describe.skipIf(!url)('database repositories', () => {
  const db = new Db(url!)
  const policies = new PolicyRepo(db)
  const orders = new OrderRepo(db)
  const attestations = new AttestationRepo(db)
  const created: string[] = []

  beforeAll(() => db.migrate())
  afterAll(async () => {
    for (const id of created) {
      await db.query('DELETE FROM convergence_check WHERE policy_id = $1', [id])
      await db.query('DELETE FROM anchor WHERE policy_id = $1', [id])
      await db.query('DELETE FROM pnl_point WHERE policy_id = $1', [id])
      await db.query('DELETE FROM order_record WHERE policy_id = $1', [id])
      await db.query('DELETE FROM policy_event WHERE policy_id = $1', [id])
      await db.query('DELETE FROM hedge_leg WHERE policy_id = $1', [id])
      await db.query('DELETE FROM protection_policy WHERE id = $1', [id])
    }
    await db.query(`DELETE FROM attestation WHERE report_hash LIKE '0xtest%'`)
    await db.close()
  })

  const newPolicy = (stockSymbol: string) =>
    policies.create(
      { mode: 'WEEKEND', requestedProtectionBps: 10_000, reopenAt: new Date(Date.now() + 3600_000), maxEndAt: new Date(Date.now() + 7200_000), cooldownSec: 300, ownerWallet: 'test-wallet', planRunId: null, closeRule: 'CONVERGENCE' },
      {
        stockSymbol,
        perpSymbol: `${stockSymbol}_USDC_PERP`,
        stockQuantity: '0.01',
        stockMarkPrice: '240',
        stockMarketValue: '2.4',
        collateralWeight: '0.6',
        collateralValue: '1.44',
        targetProtectionBps: 10_000,
        targetNotional: '2.4',
        targetQuantity: '0.01',
        accountLeverage: 1,
      },
      '0',
    )

  it('creates a policy with its leg and first event, then walks the state machine', async () => {
    const { policy, leg } = await newPolicy('TEST1.US')
    created.push(policy.id)
    expect(policy.status).toBe('VALIDATING')
    expect(leg.stockQuantity).toBe('0.01')
    expect(leg.existingShortQuantity).toBe('0')

    await policies.transition(policy.id, 'VALIDATING', 'READY')
    await policies.transition(policy.id, 'READY', 'OPENING', { note: 'test' })
    const events = await policies.events(policy.id)
    expect(events.map((e) => e.toStatus)).toEqual(['VALIDATING', 'READY', 'OPENING'])
    expect((await policies.get(policy.id))!.leg.status).toBe('OPENING')
  })

  it('refuses a transition from a status the policy has left', async () => {
    const { policy } = await newPolicy('TEST2.US')
    created.push(policy.id)
    await policies.transition(policy.id, 'VALIDATING', 'READY')
    await expect(policies.transition(policy.id, 'VALIDATING', 'READY')).rejects.toBeInstanceOf(StateConflictError)
  })

  it('allows only one live protection per stock', async () => {
    const { policy } = await newPolicy('TEST3.US')
    created.push(policy.id)
    await expect(newPolicy('TEST3.US')).rejects.toThrow(/hedge_leg_one_live_per_stock/)
    await policies.transition(policy.id, 'VALIDATING', 'FAILED')
    const again = await newPolicy('TEST3.US')
    created.push(again.policy.id)
    expect(again.policy.status).toBe('VALIDATING')
  })

  it('patches legs and policies with camelCase fields', async () => {
    const { policy } = await newPolicy('TEST4.US')
    created.push(policy.id)
    const leg = await policies.updateLeg(policy.id, { actualQuantity: '0.01', entryPrice: '239.5', openedAt: new Date() })
    expect(leg.actualQuantity).toBe('0.01')
    expect(leg.entryPrice).toBe('239.5')
    const updated = await policies.updatePolicy(policy.id, { actualProtectionBps: 9980, receipt: { ok: true } })
    expect(updated.actualProtectionBps).toBe(9980)
    expect(updated.receipt).toEqual({ ok: true })
  })

  it('stores orders once per logical id and lists unresolved ones', async () => {
    const { policy } = await newPolicy('TEST5.US')
    created.push(policy.id)
    const record = await orders.create({
      policyId: policy.id,
      logicalId: `${policy.id}_TEST5.US_USDC_PERP_OPEN_1`,
      clientId: 123456,
      purpose: 'OPEN',
      symbol: 'TEST5.US_USDC_PERP',
      side: 'Ask',
      reduceOnly: false,
      quantity: '0.01',
      price: '239',
    })
    expect(record.status).toBe('PENDING')
    expect((await orders.unresolved()).some((o) => o.id === record.id)).toBe(true)
    await expect(orders.create({ ...record, logicalId: record.logicalId })).rejects.toThrow()
    const done = await orders.update(record.logicalId, { status: 'FILLED', executedQuantity: '0.01', avgPrice: '239.1', fee: '0.001' })
    expect(done.executedQuantity).toBe('0.01')
    expect((await orders.unresolved()).some((o) => o.id === record.id)).toBe(false)
  })

  it('stores an attestation once and records convergence checks against it', async () => {
    const { policy } = await newPolicy('TEST6.US')
    created.push(policy.id)
    const row = {
      reportHash: `0xtest${Date.now()}`,
      mode: 'SIMULATION' as const,
      rawReport: 'aa',
      context: 'bb',
      signatures: ['cc'],
      validSignatures: 0,
      workflowId: null,
      workflowOwner: null,
      observedAt: new Date(),
      payload: { observations: [] },
    }
    const stored = await attestations.insert(row)
    expect(stored).not.toBeNull()
    expect(await attestations.insert(row)).toBeNull()
    const check = await attestations.addCheck({
      policyId: policy.id,
      attestationId: stored!.id,
      observedAt: new Date(),
      basisBps: '12.5',
      session: 'REGULAR',
      passed: true,
      counted: true,
      rejectReason: null,
      countAfter: 1,
    })
    expect(check.countAfter).toBe(1)
    expect((await attestations.countedChecks(policy.id, 3)).length).toBe(1)
  })
})
