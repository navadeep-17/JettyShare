'use client'

import { boardCountdown } from '@/lib/time'

export function Countdown({ expiresAt, nowMs }: { expiresAt: string; nowMs: number }) {
  const value = boardCountdown(expiresAt, nowMs)
  if (value.expired) return <span className="status status-urgent">EXPIRED</span>

  const className = value.band === 'URGENT'
    ? 'status status-urgent'
    : value.band === 'SOON'
      ? 'status status-soon'
      : 'status status-available'

  return <span className={className}>{value.band} · {value.text}</span>
}
