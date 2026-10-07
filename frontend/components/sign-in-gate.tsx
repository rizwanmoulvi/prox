'use client'

// Everything behind this gate needs an operator session: an allowlisted wallet that signed the challenge.

import { useWallet } from '@solana/wallet-adapter-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import bs58 from 'bs58'
import dynamic from 'next/dynamic'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { api, ApiError } from '@/lib/api'

// The wallet button reads window.* at render time, so it is client-only.
export const WalletButton = dynamic(() => import('@solana/wallet-adapter-react-ui').then((m) => m.WalletMultiButton), { ssr: false })

export function useSession() {
  return useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 60_000 })
}

export function SignInGate({ children }: { children: ReactNode }) {
  const session = useSession()
  if (session.isPending) return <p className="p-6 text-sm text-muted-foreground">Checking session…</p>
  if (session.isError) {
    return (
      <Card className="m-6 max-w-md">
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
    <div className="mx-auto mt-16 max-w-md px-4">
      <Card>
        <CardHeader>
          <CardTitle>Sign in to ProX</CardTitle>
          <CardDescription>
            Connect your Backpack wallet and sign a one-time message. Only the operator wallets listed in the backend can trade.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <WalletButton />
          <Button onClick={() => signIn.mutate()} disabled={!connected || signIn.isPending}>
            {signIn.isPending ? 'Waiting for signature…' : 'Sign in'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
