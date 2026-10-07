'use client'

// Underlying move, hedge move and net result over the life of a protection (PRD section 24).

import { ColorType, LineSeries, createChart, type IChartApi, type ISeriesApi, type LineData, type UTCTimestamp } from 'lightweight-charts'
import { useEffect, useRef } from 'react'
import type { PnlPoint } from '@/lib/api'

export function PnlChart({ points }: { points: PnlPoint[] }) {
  const container = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const series = useRef<{ underlying: ISeriesApi<'Line'>; hedge: ISeriesApi<'Line'>; net: ISeriesApi<'Line'> } | null>(null)

  useEffect(() => {
    if (!container.current) return
    const created = createChart(container.current, {
      height: 260,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#4a4537', fontFamily: 'Mulish, sans-serif', attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: '#ddd4bd' } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      handleScroll: false,
      handleScale: false,
    })
    series.current = {
      underlying: created.addSeries(LineSeries, { color: '#8d8670', lineWidth: 2, title: 'Underlying' }),
      hedge: created.addSeries(LineSeries, { color: '#1c1a14', lineWidth: 2, title: 'Hedge' }),
      net: created.addSeries(LineSeries, { color: '#a87e36', lineWidth: 3, title: 'Net' }),
    }
    chart.current = created
    const resize = () => created.applyOptions({ width: container.current?.clientWidth ?? 600 })
    resize()
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      created.remove()
      chart.current = null
      series.current = null
    }
  }, [])

  useEffect(() => {
    if (!series.current) return
    const toLine = (pick: (p: PnlPoint) => string): LineData[] => {
      const seen = new Set<number>()
      return points
        .map((p) => ({ time: Math.floor(new Date(p.at).getTime() / 1000) as UTCTimestamp, value: Number(pick(p)) }))
        .filter((d) => (seen.has(d.time) ? false : (seen.add(d.time), true)))
        .sort((a, b) => (a.time as number) - (b.time as number))
    }
    series.current.underlying.setData(toLine((p) => p.underlyingPnl))
    series.current.hedge.setData(toLine((p) => p.hedgePnl))
    series.current.net.setData(toLine((p) => p.net))
    chart.current?.timeScale().fitContent()
  }, [points])

  return <div ref={container} className="w-full" />
}
