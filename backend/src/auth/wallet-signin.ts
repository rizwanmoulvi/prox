// Sign-in with a Solana wallet: the server issues a short-lived challenge, the wallet signs it,
// and only allowlisted addresses get a session cookie.

import bs58 from 'bs58'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import nacl from 'tweetnacl'
import { z } from 'zod'
import type { Config } from '../config'

export const SESSION_COOKIE = 'prox_session'
const CHALLENGE_TTL = '5m'
const SESSION_TTL = '12h'

const ChallengeBody = z.object({ publicKey: z.string().min(32).max(44) })
const VerifyBody = z.object({
  publicKey: z.string().min(32).max(44),
  challenge: z.string().min(1),
  /** base58 or base64 encoded 64-byte signature of the challenge message. */
  signature: z.string().min(1),
})

interface ChallengeClaims {
  purpose: 'challenge'
  sub: string
  nonce: string
  issued: string
}

interface SessionClaims {
  purpose: 'session'
  sub: string
}

export class WalletAuth {
  constructor(
    private readonly app: FastifyInstance,
    private readonly config: Config,
  ) {}

  routes(): void {
    this.app.post('/api/auth/challenge', async (request, reply) => {
      const { publicKey } = ChallengeBody.parse(request.body)
      this.assertAllowed(publicKey)
      const claims: ChallengeClaims = { purpose: 'challenge', sub: publicKey, nonce: bs58.encode(nacl.randomBytes(16)), issued: new Date().toISOString() }
      const challenge = this.app.jwt.sign(claims, { expiresIn: CHALLENGE_TTL })
      return reply.send({ challenge, message: challengeMessage(claims) })
    })

    this.app.post('/api/auth/verify', async (request, reply) => {
      const body = VerifyBody.parse(request.body)
      const claims = this.app.jwt.verify<ChallengeClaims>(body.challenge)
      if (claims.purpose !== 'challenge' || claims.sub !== body.publicKey) throw new AuthError('challenge does not match the wallet')
      this.assertAllowed(body.publicKey)
      const ok = nacl.sign.detached.verify(Buffer.from(challengeMessage(claims)), decodeSignature(body.signature), bs58.decode(body.publicKey))
      if (!ok) throw new AuthError('signature does not verify')
      const session = this.app.jwt.sign({ purpose: 'session', sub: body.publicKey } satisfies SessionClaims, { expiresIn: SESSION_TTL })
      reply.setCookie(SESSION_COOKIE, session, {
        httpOnly: true,
        sameSite: 'lax',
        secure: this.config.FRONTEND_ORIGIN.startsWith('https://'),
        path: '/',
        maxAge: 12 * 3600,
      })
      return reply.send({ wallet: body.publicKey })
    })

    this.app.post('/api/auth/logout', async (_request, reply) => {
      reply.clearCookie(SESSION_COOKIE, { path: '/' })
      return reply.send({ ok: true })
    })

    this.app.get('/api/auth/me', async (request, reply) => {
      const wallet = this.walletOf(request)
      return reply.send({ wallet })
    })
  }

  /** preHandler for routes that need an operator. */
  requireSession = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const wallet = this.walletOf(request)
    if (!wallet) return reply.code(401).send({ error: 'sign in with an allowlisted wallet' })
    request.wallet = wallet
  }

  private walletOf(request: FastifyRequest): string | null {
    const token = request.cookies[SESSION_COOKIE]
    if (!token) return null
    try {
      const claims = this.app.jwt.verify<SessionClaims>(token)
      if (claims.purpose !== 'session' || !this.config.OPERATOR_WALLETS.includes(claims.sub)) return null
      return claims.sub
    } catch {
      return null
    }
  }

  private assertAllowed(publicKey: string): void {
    if (bs58.decode(publicKey).length !== 32) throw new AuthError('not a Solana public key')
    if (!this.config.OPERATOR_WALLETS.includes(publicKey)) throw new AuthError('this wallet is not allowed to operate the app')
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export function challengeMessage(claims: ChallengeClaims): string {
  return `ProX sign-in\nWallet: ${claims.sub}\nNonce: ${claims.nonce}\nIssued: ${claims.issued}`
}

function decodeSignature(signature: string): Uint8Array {
  const asBase58 = (() => {
    try {
      return bs58.decode(signature)
    } catch {
      return null
    }
  })()
  if (asBase58?.length === 64) return asBase58
  const asBase64 = Buffer.from(signature, 'base64')
  if (asBase64.length === 64) return asBase64
  throw new AuthError('signature must be 64 bytes, base58 or base64')
}

declare module 'fastify' {
  interface FastifyRequest {
    wallet?: string
  }
}
