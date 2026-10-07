'use client'

// Server-sent events from the backend keep the screens live without polling.

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { API_URL } from '@/lib/api'

export interface PnlEvent {
  policyId: string
  stockPrice: string
  perpPrice: string
  underlyingPnl: string
  hedgePnl: string
  costs: string
  net: string
  mmr: string
}

export interface StreamState {
  connected: boolean
  pnl: Record<string, PnlEvent>
  basis: Record<string, { basisBps: number; session: string }>
  account: { mmr: string; imr: string; risk: string; session: string } | null
}

export function useStream(enabled: boolean): StreamState {
  const queryClient = useQueryClient()
  const [state, setState] = useState<StreamState>({ connected: false, pnl: {}, basis: {}, account: null })

  useEffect(() => {
    if (!enabled) return
    const source = new EventSource(`${API_URL}/api/stream`, { withCredentials: true })
    const data = <T>(event: MessageEvent): T => (JSON.parse(event.data) as { data: T }).data

    source.onopen = () => setState((s) => ({ ...s, connected: true }))
    source.onerror = () => setState((s) => ({ ...s, connected: false }))
    source.addEventListener('policy.pnl', (event) => {
      const pnl = data<PnlEvent>(event as MessageEvent)
      setState((s) => ({ ...s, pnl: { ...s.pnl, [pnl.policyId]: pnl } }))
    })
    source.addEventListener('policy.basis', (event) => {
      const basis = data<{ policyId: string; basisBps: number; session: string }>(event as MessageEvent)
      setState((s) => ({ ...s, basis: { ...s.basis, [basis.policyId]: basis } }))
      void queryClient.invalidateQueries({ queryKey: ['policy', basis.policyId] })
    })
    source.addEventListener('account.health', (event) => {
      setState((s) => ({ ...s, account: data(event as MessageEvent) }))
    })
    for (const type of ['policy.updated', 'policy.closed', 'policy.risk', 'oracle.report']) {
      source.addEventListener(type, (event) => {
        const payload = data<{ policyId?: string }>(event as MessageEvent)
        void queryClient.invalidateQueries({ queryKey: ['policies'] })
        void queryClient.invalidateQueries({ queryKey: ['portfolio'] })
        if (payload.policyId) void queryClient.invalidateQueries({ queryKey: ['policy', payload.policyId] })
      })
    }
    return () => source.close()
  }, [enabled, queryClient])

  return state
}
