'use client'

import { useEffect, useState } from 'react'

/** The current time, refreshed on an interval, for countdowns. Null until mounted so server and client agree. */
export function useNow(everyMs = 30_000): number | null {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    tick()
    const timer = setInterval(tick, everyMs)
    return () => clearInterval(timer)
  }, [everyMs])
  return now
}
