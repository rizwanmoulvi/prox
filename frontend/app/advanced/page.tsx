'use client'

// Optional account and margin detail, straight from Backpack (PRD section 39).

import { useQuery } from '@tanstack/react-query'
import { ErrorCard } from '@/components/error-card'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'

export default function AdvancedPage() {
  const advanced = useQuery({ queryKey: ['advanced'], queryFn: api.advanced, refetchInterval: 15_000 })
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 15_000 })
  if (advanced.isError) return <ErrorCard title="Could not read the account" message={(advanced.error as Error).message} />
  if (!advanced.data) return <Skeleton className="h-64 w-full" />
  const sections: [string, string, unknown][] = [
    ['Account settings', 'GET /api/v1/account', advanced.data.account],
    ['Collateral and margin', 'GET /api/v1/capital/collateral', advanced.data.collateral],
    ['Open positions', 'GET /api/v1/position', advanced.data.positions],
    ['Open orders', 'GET /api/v1/orders', advanced.data.openOrders],
    ['Balances', 'GET /api/v1/capital', advanced.data.balances],
    ['Backend', '/api/health', { ...health.data, anchorBalanceLamports: advanced.data.anchorBalanceLamports }],
  ]
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {sections.map(([title, source, value]) => (
        <Card key={title}>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{source}</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(value, null, 2)}</pre>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
