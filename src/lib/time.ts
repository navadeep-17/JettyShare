export type UrgencyBand = 'URGENT' | 'SOON' | 'AVAILABLE'

export function serverClockOffset(serverNow: string, receivedAtMs = Date.now()): number {
  const parsed = new Date(serverNow).getTime()
  return Number.isFinite(parsed) ? parsed - receivedAtMs : 0
}

export function adjustedNow(offsetMs: number, clientNowMs = Date.now()): number {
  return clientNowMs + offsetMs
}

export function remainingMs(expiresAt: string, nowMs: number): number {
  return new Date(expiresAt).getTime() - nowMs
}

export function boardCountdown(expiresAt: string, nowMs: number): {
  expired: boolean
  band: UrgencyBand
  text: string
} {
  const ms = remainingMs(expiresAt, nowMs)
  if (ms <= 0) return { expired: true, band: 'URGENT', text: 'Expired' }

  const seconds = Math.max(0, Math.floor(ms / 1000))
  const band: UrgencyBand = ms <= 15 * 60_000
    ? 'URGENT'
    : ms <= 30 * 60_000
      ? 'SOON'
      : 'AVAILABLE'

  if (seconds < 10 * 60) {
    const minutes = Math.floor(seconds / 60)
    const remainder = seconds % 60
    return { expired: false, band, text: `${minutes}m ${String(remainder).padStart(2, '0')}s left` }
  }

  const wholeMinutes = Math.floor(seconds / 60)
  if (wholeMinutes < 60) return { expired: false, band, text: `${wholeMinutes} min left` }

  const hours = Math.floor(wholeMinutes / 60)
  const minutes = wholeMinutes % 60
  return {
    expired: false,
    band,
    text: minutes ? `${hours}h ${String(minutes).padStart(2, '0')}m left` : `${hours}h left`,
  }
}

export function copyRemaining(ms: number): string {
  if (ms <= 0) return 'expired'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return 'under 1 min left'
  const wholeMinutes = Math.floor(seconds / 60)
  if (wholeMinutes < 60) return `${wholeMinutes} min left`
  const hours = Math.floor(wholeMinutes / 60)
  const minutes = wholeMinutes % 60
  return minutes ? `${hours}h ${String(minutes).padStart(2, '0')}m left` : `${hours}h left`
}

export function lastCheckedAge(checkedAtMs: number, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - checkedAtMs) / 60_000))
  if (minutes < 1) return 'under 1 min ago'
  if (minutes === 1) return '1 min ago'
  return `${minutes} min ago`
}
