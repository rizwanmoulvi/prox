'use client'

import { useWallet } from '@solana/wallet-adapter-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Suspense, type ReactNode } from 'react'
import { Loader } from '@/components/loader'
import { SignInGate, useSession } from '@/components/sign-in-gate'
import { useStream } from '@/hooks/use-stream'
import { api } from '@/lib/api'
import { SESSION_LABEL, shortAddress } from '@/lib/format'

const NAV = [
  { href: '/app', label: 'Portfolio' },
  { href: '/app/protect', label: 'Protect' },
  { href: '/app/advanced', label: 'Advanced' },
]

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1240px] flex-col px-5 pb-16 sm:px-8">
      {/* URL hooks only resolve at request time; Suspense lets the shell prerender around them. */}
      <Suspense fallback={<div className="h-[72px]" />}>
        <Header />
      </Suspense>
      <main className="flex-1 pt-8 sm:pt-10">
        <SignInGate>
          <Suspense fallback={<Loader />}>{children}</Suspense>
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
  const queryClient = useQueryClient()
  const { disconnect } = useWallet()
  // Clear the session cookie, then drop the wallet so the gate does not sign straight back in.
  const signOut = useMutation({
    mutationFn: api.logout,
    onSuccess: async () => {
      await disconnect().catch(() => undefined)
      queryClient.clear()
    },
  })
  const marketState = stream.account?.session ?? health.data?.session.state
  const marketOpen = marketState === 'REGULAR'
  const signedIn = !!session.data?.wallet
  // A live protection or its receipt belongs to the portfolio section.
  const section = pathname.startsWith('/app/protect') && !pathname.startsWith('/app/protection') ? '/app/protect' : pathname.startsWith('/app/advanced') ? '/app/advanced' : '/app'

  return (
    <header className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-3 border-b border-line py-4 md:grid-cols-[1fr_auto_1fr]">
      <Link href="/" className="justify-self-start font-heading text-[1.5rem] font-semibold tracking-[0.2px] text-ink no-underline">
        ProX
      </Link>

      {signedIn && (
        <nav aria-label="Sections" className="order-3 col-span-2 flex gap-1 rounded-full bg-paper-3 p-1 shadow-[inset_0_0_0_1px_var(--line)] md:order-none md:col-span-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={section === item.href ? 'page' : undefined}
              className={`flex-1 rounded-full px-5 py-2 text-center text-sm font-bold no-underline transition-[color,background-color] duration-150 ease-out-strong md:flex-none ${
                section === item.href ? 'bg-ink text-paper' : 'text-ink-soft hover:text-ink'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}

      <div className="flex items-center justify-end gap-3 justify-self-end text-sm md:col-start-3">
        {marketState && (
          <span className="hidden items-center gap-2 text-ink-soft sm:flex" title="US stock market session">
            <span className={`size-2 rounded-full ${marketOpen ? 'bg-ink' : 'bg-gold'}`} aria-hidden />
            {SESSION_LABEL[marketState] ?? marketState}
          </span>
        )}
        {health.data && !health.data.tradingEnabled && (
          <span className="rounded-full px-3 py-1 text-[0.8rem] font-bold text-danger shadow-[inset_0_0_0_1.5px_var(--danger)]" title="The backend is running with TRADING_ENABLED=false">
            Trading off
          </span>
        )}
        {signedIn && (
          <span className="flex items-center rounded-full shadow-[inset_0_0_0_1.5px_var(--line)]">
            <span className="py-1.5 pr-2 pl-3.5 font-mono text-[0.78rem] text-ink-soft" title={session.data!.wallet!}>
              {shortAddress(session.data!.wallet!)}
            </span>
            <button
              onClick={() => signOut.mutate()}
              disabled={signOut.isPending}
              className="cursor-pointer rounded-full py-1.5 pr-3.5 pl-2 text-[0.8rem] font-bold text-ink-soft transition-colors duration-150 hover:text-ink disabled:opacity-50"
            >
              Sign out
            </button>
          </span>
        )}
      </div>
    </header>
  )
}
