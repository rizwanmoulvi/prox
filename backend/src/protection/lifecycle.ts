// Time-driven moves of the protection state machine (PRD section 34). Pure, so it can be tested
// against the clock without Backpack.

import type { SessionState } from '@prox/core'
import type { Policy, PolicyStatus } from '../db/types'

const WAITING: readonly PolicyStatus[] = ['ACTIVE', 'PARTIAL', 'WAIT_REOPEN', 'WAIT_CONVERGENCE']

/** The status a hedged policy should be in now, or null when it should stay where it is. */
export function nextLifecycleStatus(policy: Policy, nowMs: number, session: SessionState): PolicyStatus | null {
  if (!WAITING.includes(policy.status)) return null
  if (nowMs >= policy.maxEndAt.getTime()) return 'EXPIRED'
  // A window that closes at its end has no reopen to wait for.
  if (policy.closeRule === 'AT_END') return null
  if (policy.demoOverride || nowMs >= policy.reopenAt.getTime()) {
    return policy.status === 'WAIT_CONVERGENCE' ? null : 'WAIT_CONVERGENCE'
  }
  if (policy.status === 'WAIT_CONVERGENCE') return null
  // A custom window ignores the session: it waits for the chosen time.
  if (policy.mode === 'CUSTOM') return null
  const marketOpen = session === 'REGULAR'
  if (!marketOpen && policy.status !== 'WAIT_REOPEN') return 'WAIT_REOPEN'
  if (marketOpen && policy.status === 'WAIT_REOPEN') return hedgedStatus(policy)
  return null
}

/** ACTIVE when the fill covered the request, PARTIAL otherwise (PRD section 20). */
export function hedgedStatus(policy: Pick<Policy, 'actualProtectionBps' | 'requestedProtectionBps'>): PolicyStatus {
  return policy.actualProtectionBps >= policy.requestedProtectionBps ? 'ACTIVE' : 'PARTIAL'
}

/** Convergence checks only count once the cooldown after the reopen has passed (PRD section 31). */
export function checksCountFrom(policy: Pick<Policy, 'reopenAt' | 'cooldownSec'>): number {
  return policy.reopenAt.getTime() + policy.cooldownSec * 1000
}
