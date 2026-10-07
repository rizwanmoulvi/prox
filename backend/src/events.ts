// In-process fan-out of state changes to the SSE route and the logs.

import { EventEmitter } from 'node:events'

export interface AppEvent {
  type: string
  at: string
  data: unknown
}

export class EventBus {
  private readonly emitter = new EventEmitter()

  publish(type: string, data: unknown): void {
    this.emitter.emit('event', { type, at: new Date().toISOString(), data } satisfies AppEvent)
  }

  subscribe(listener: (event: AppEvent) => void): () => void {
    this.emitter.on('event', listener)
    return () => this.emitter.off('event', listener)
  }
}
