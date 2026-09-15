import type { BoardSnapshot, QuantityUnit } from './types'

function unitLabel(unit: QuantityUnit, quantity: number): string {
  if (unit === 'KG') return 'kg'
  const base = unit.toLowerCase()
  return quantity === 1 ? base : `${base}s`
}

function remainingLabel(ms: number): string {
  const safe = Math.max(0, ms)
  const totalMinutes = Math.ceil(safe / 60000)
  if (totalMinutes < 60) return `${totalMinutes} min left`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes ? `${hours}h ${String(minutes).padStart(2, '0')}m left` : `${hours}h left`
}

export function buildShareSummary(
  snapshot: BoardSnapshot,
  origin: string,
  nowMs = Date.now(),
  lastKnown = false,
): string {
  const live = snapshot.items.filter((item) => new Date(item.expires_at).getTime() > nowMs)
  const lines = live.map((item, index) => {
    const remainingMs = new Date(item.expires_at).getTime() - nowMs
    const urgent = remainingMs <= 15 * 60 * 1000 ? 'URGENT | ' : ''
    const quantity = Number(item.quantity_value)
    return `${index + 1}. ${urgent}${item.item_type} | ${quantity} ${unitLabel(item.quantity_unit, quantity)} | Berth ${item.berth} | ${remainingLabel(remainingMs)}`
  })

  const heading = lastKnown
    ? 'JETTYSHARE - LAST KNOWN SUPPLIES'
    : 'JETTYSHARE - SUPPLIES AVAILABLE NOW'
  const freshness = lastKnown
    ? 'Connection is unavailable. This is last-known information - verify on the live board before pickup.'
    : 'Availability changes quickly - check the live board before pickup.'

  return `${heading}\n\n${lines.length ? lines.join('\n') : 'No supplies currently available.'}\n\nLive board: ${origin.replace(/\/$/, '')}/\n${freshness}`
}
