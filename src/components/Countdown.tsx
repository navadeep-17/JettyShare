'use client'

import { useEffect, useState } from 'react'

export function formatRemaining(ms: number) {
  if (ms <= 0) return 'Expired'
  const totalMinutes = Math.ceil(ms / 60000)
  if (totalMinutes < 60) return `${totalMinutes} min left`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes ? `${hours}h ${String(minutes).padStart(2, '0')}m left` : `${hours}h left`
}

export function Countdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const ms = new Date(expiresAt).getTime() - now
  const urgent = ms > 0 && ms <= 15 * 60 * 1000
  return <span className={urgent ? 'status status-urgent' : 'status'}>{urgent ? 'URGENT · ' : ''}{formatRemaining(ms)}</span>
}
