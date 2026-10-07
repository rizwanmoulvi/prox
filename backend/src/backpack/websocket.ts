// One WebSocket to Backpack that stays subscribed across reconnects.
// Emits 'data' (stream, payload), 'open' and 'close'.

import { EventEmitter } from 'node:events'
import WebSocket from 'ws'
import type { BackpackClient } from './client'

export const BACKPACK_WS_URL = 'wss://ws.backpack.exchange'

// The server pings every 60s. Two missed pings means the link is dead even if TCP has not noticed.
const SILENCE_LIMIT_MS = 150_000
const MAX_BACKOFF_MS = 30_000

export class BackpackSocket extends EventEmitter {
  private ws: WebSocket | null = null
  private readonly streams = new Set<string>()
  private stopped = false
  private attempt = 0
  private lastHeardAt = 0
  private watchdog: NodeJS.Timeout | null = null

  constructor(
    private readonly client: BackpackClient,
    private readonly url = BACKPACK_WS_URL,
  ) {
    super()
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  connect(): void {
    this.stopped = false
    this.open()
    this.watchdog ??= setInterval(() => this.dropIfSilent(), 30_000)
  }

  /** Streams named account.* are private and are signed automatically. */
  subscribe(streams: string[]): void {
    const fresh = streams.filter((s) => !this.streams.has(s))
    fresh.forEach((s) => this.streams.add(s))
    if (this.connected) this.sendSubscriptions(fresh)
  }

  unsubscribe(streams: string[]): void {
    const known = streams.filter((s) => this.streams.delete(s))
    if (this.connected && known.length) this.ws!.send(JSON.stringify({ method: 'UNSUBSCRIBE', params: known }))
  }

  close(): void {
    this.stopped = true
    if (this.watchdog) clearInterval(this.watchdog)
    this.watchdog = null
    this.ws?.close()
  }

  private open(): void {
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.on('open', () => {
      this.attempt = 0
      this.lastHeardAt = Date.now()
      this.sendSubscriptions([...this.streams])
      this.emit('open')
    })
    ws.on('ping', () => (this.lastHeardAt = Date.now()))
    ws.on('message', (raw) => this.handleMessage(raw.toString()))
    ws.on('error', () => ws.terminate())
    ws.on('close', () => this.handleClose(ws))
  }

  private handleMessage(text: string): void {
    this.lastHeardAt = Date.now()
    const message = JSON.parse(text) as { stream?: string; data?: unknown; error?: unknown }
    if (message.stream) this.emit('data', message.stream, message.data)
    else if (message.error) this.emit('streamError', message.error)
  }

  private handleClose(ws: WebSocket): void {
    if (this.ws !== ws) return
    this.ws = null
    this.emit('close')
    if (this.stopped) return
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt++)
    setTimeout(() => !this.stopped && this.open(), delay)
  }

  private sendSubscriptions(streams: string[]): void {
    const isPrivate = (s: string) => s.startsWith('account.')
    const publicStreams = streams.filter((s) => !isPrivate(s))
    const privateStreams = streams.filter(isPrivate)
    if (publicStreams.length) this.ws!.send(JSON.stringify({ method: 'SUBSCRIBE', params: publicStreams }))
    if (privateStreams.length) {
      const signature = this.client.subscribeSignature()
      this.ws!.send(JSON.stringify({ method: 'SUBSCRIBE', params: privateStreams, signature }))
    }
  }

  private dropIfSilent(): void {
    if (this.connected && Date.now() - this.lastHeardAt > SILENCE_LIMIT_MS) this.ws!.terminate()
  }
}
