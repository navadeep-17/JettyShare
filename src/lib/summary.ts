import type { BoardSnapshot, QuantityUnit } from './types'
import { copyRemaining, lastCheckedAge } from './time'

function unitLabel(unit: QuantityUnit, quantity: number): string {
  if (unit === 'KG') return 'kg'
  const base = unit.toLowerCase()
  return quantity === 1 ? base : `${base}s`
}

export function canonicalBoardUrl(currentOrigin?: string): string {
  const configured = process.env.NEXT_PUBLIC_CANONICAL_APP_URL?.trim()
  const origin = configured || currentOrigin || 'http://localhost:3000'
  return new URL('/', origin).toString()
}

export function activeSummaryItems(snapshot: BoardSnapshot, nowMs: number) {
  return snapshot.items.filter((item) => new Date(item.expires_at).getTime() > nowMs)
}

function formatLines(snapshot: BoardSnapshot, nowMs: number, suffix = ''): string[] {
  return activeSummaryItems(snapshot, nowMs).map((item, index) => {
    const remainingMs = new Date(item.expires_at).getTime() - nowMs
    const urgent = remainingMs <= 15 * 60 * 1000 ? 'URGENT | ' : ''
    const quantity = Number(item.quantity_value)
    return `${index + 1}. ${urgent}${item.item_type} | ${quantity} ${unitLabel(item.quantity_unit, quantity)} | Berth ${item.berth} | ${copyRemaining(remainingMs)}${suffix}`
  })
}

export function buildShareSummary(snapshot: BoardSnapshot, origin: string, nowMs: number): string {
  const lines = formatLines(snapshot, nowMs)
  return `JETTYSHARE - SUPPLIES AVAILABLE NOW\n\n${lines.join('\n')}\n\nLive board: ${canonicalBoardUrl(origin)}\nAvailability changes quickly - check the live board before pickup.`
}

export function buildLastKnownSummary(
  snapshot: BoardSnapshot,
  origin: string,
  checkedAtMs: number,
  nowMs: number,
): string {
  const snapshotNow = new Date(snapshot.server_now).getTime()
  const lines = formatLines(snapshot, Number.isFinite(snapshotNow) ? snapshotNow : checkedAtMs, ' at last check')
  return `LAST KNOWN - JETTYSHARE SUPPLIES\nLast checked ${lastCheckedAge(checkedAtMs, nowMs)}\n\n${lines.length ? lines.join('\n') : 'No supplies were available at the last successful check.'}\n\nLive board: ${canonicalBoardUrl(origin)}\nThis copy may be outdated - check the live board before pickup.`
}
