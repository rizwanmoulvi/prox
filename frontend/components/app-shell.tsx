'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Suspense, type ReactNode } from 'react'
import { SignInGate, useSession, WalletButton } from '@/components/sign-in-gate'
import { Badge } from '@/components/ui/badge'
import { useStream } from '@/hooks/use-stream'
import { api } from '@/lib/api'
import { SESSION_LABEL, shortAddress } from '@/lib/format'

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/protect', label: 'Protect' },
  { href: '/activity', label: 'Activity' },
  { href: '/advanced', label: 'Details' },
]

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      {/* URL hooks only resolve at request time; Suspense lets the shell prerender around them. */}
      <Suspense fallback={<div className="h-14 border-b" />}>
        <Header />
      </Suspense>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <SignInGate>
          <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>{children}</Suspense>
        </SignInGate>
      </main>
    </div>
  )
}

function Header() {
  const pathname = usePathname()
  const session = useSession()
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 30_000 })
  const stream = useStream(!!session.data?.wallet)
  const marketState = stream.account?.session ?? health.data?.session.state

  return (
    <header className="border-b">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
        <Link href="/" className="text-base font-semibold tracking-tight">
          ProX
        </Link>
        <nav className="flex gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-1.5 text-sm ${pathname === item.href ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {marketState && <Badge variant="outline">US market: {(SESSION_LABEL[marketState] ?? marketState).toLowerCase()}</Badge>}
          {health.data && !health.data.tradingEnabled && <Badge variant="destructive">Protection paused</Badge>}
          {session.data?.wallet ? (
            <span className="font-mono text-xs text-muted-foreground">{shortAddress(session.data.wallet)}</span>
          ) : (
            <WalletButton />
          )}
        </div>
      </div>
    </header>
  )
}
