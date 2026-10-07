'use client'

// Everything behind this gate needs an operator session: an allowlisted wallet that signed the challenge.

import { useWallet } from '@solana/wallet-adapter-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import bs58 from 'bs58'
import dynamic from 'next/dynamic'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { Loader } from '@/components/loader'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { api, ApiError } from '@/lib/api'

// The wallet button reads window.* at render time, so it is client-only.
export const WalletButton = dynamic(() => import('@solana/wallet-adapter-react-ui').then((m) => m.WalletMultiButton), { ssr: false })

// The adapter's default is a purple button; this restyles it as Umbra's ghost button.
const WALLET_BUTTON_STYLE = {
  width: '100%',
  height: 52,
  justifyContent: 'center',
  borderRadius: 10,
  background: 'transparent',
  boxShadow: 'inset 0 0 0 1.5px var(--ink)',
  color: 'var(--ink)',
  fontFamily: 'var(--font-ui)',
  fontSize: 16,
  fontWeight: 700,
  letterSpacing: '0.2px',
} as const

export function useSession() {
  return useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 60_000 })
}

export function SignInGate({ children }: { children: ReactNode }) {
  const session = useSession()
  if (session.isPending) return <Loader label="Checking session" />
  if (session.isError) {
    return (
      <Card className="mx-auto mt-10 max-w-md">
        <CardHeader>
          <CardTitle>Backend unreachable</CardTitle>
          <CardDescription>{(session.error as Error).message}. Start the backend and reload.</CardDescription>
        </CardHeader>
      </Card>
    )
  }
  if (!session.data?.wallet) return <SignIn />
  return <>{children}</>
}

function SignIn() {
  const { publicKey, signMessage, connected } = useWallet()
  const queryClient = useQueryClient()
  const signIn = useMutation({
    mutationFn: async () => {
      if (!publicKey || !signMessage) throw new Error('Connect a wallet that can sign messages')
      const address = publicKey.toBase58()
      const { challenge, message } = await api.challenge(address)
      const signature = await signMessage(new TextEncoder().encode(message))
      return api.verify({ publicKey: address, challenge, signature: bs58.encode(signature) })
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['me'] }),
    onError: (error) => toast.error(error instanceof ApiError ? error.message : (error as Error).message),
  })

  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-[460px] flex-col items-center justify-center gap-[18px] text-center">
      <h1 className="font-heading text-[clamp(3.4rem,16vw,5rem)] leading-[0.95] font-medium tracking-[-1px]">ProX</h1>
      <p className="-mt-2 font-heading text-[1.05rem] tracking-[0.3px] text-ink-soft italic">pro·tect /prəˈtekt/ — to keep from loss</p>
      <p className="max-w-[36ch] leading-[1.6] text-ink-soft">
        Hold your tokenized stock and hedge it while the market is shut. Connect a Backpack wallet and sign once to begin.
      </p>
      <div className="mt-2 flex w-full max-w-[340px] flex-col gap-[11px]">
        <WalletButton style={WALLET_BUTTON_STYLE} />
        <Button size="lg" className="w-full" onClick={() => signIn.mutate()} disabled={!connected || signIn.isPending}>
          {signIn.isPending ? 'Waiting for signature…' : 'Sign in'}
        </Button>
      </div>
      <p className="text-sm text-ink-faint">Signing is free and sends no transaction. Only operator wallets can trade.</p>
      <p className="text-[0.76rem] tracking-[1.5px] text-ink-faint uppercase">Backpack · Solana · Chainlink CRE</p>
    </div>
  )
}
