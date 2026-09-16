import type { ActiveBoardItem, BoardSnapshot, QuantityUnit } from './types'
import { copyRemaining, lastCheckedAge } from './time'

export type SummaryInput = {
  items: ActiveBoardItem[]
  adjustedNowMs: number
  canonicalBoardUrl: string
}

export type SummaryResult = {
  text: string
  includedCount: number
  includedIds: string[]
}

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

function formatLines(items: ActiveBoardItem[], nowMs: number, suffix = ''): string[] {
  return items.map((item, index) => {
    const remainingMs = new Date(item.expires_at).getTime() - nowMs
    const urgent = remainingMs <= 15 * 60 * 1000 ? 'URGENT | ' : ''
    const quantity = Number(item.quantity_value)
    return `${index + 1}. ${urgent}${item.item_type} | ${quantity} ${unitLabel(item.quantity_unit, quantity)} | Berth ${item.berth} | ${copyRemaining(remainingMs)}${suffix}`
  })
}

export function formatActiveSupplySummary(input: SummaryInput): SummaryResult {
  const included = input.items.filter((item) => new Date(item.expires_at).getTime() > input.adjustedNowMs)
  if (!included.length) return { text: '', includedCount: 0, includedIds: [] }

  const lines = formatLines(included, input.adjustedNowMs)
  return {
    text: `JETTYSHARE - SUPPLIES AVAILABLE NOW\n\n${lines.join('\n')}\n\nLive board: ${new URL('/', input.canonicalBoardUrl).toString()}\nAvailability changes quickly - check the live board before pickup.`,
    includedCount: included.length,
    includedIds: included.map((item) => item.id),
  }
}

export function buildShareSummary(snapshot: BoardSnapshot, origin: string, nowMs: number): string {
  return formatActiveSupplySummary({
    items: snapshot.items,
    adjustedNowMs: nowMs,
    canonicalBoardUrl: canonicalBoardUrl(origin),
  }).text
}

export function buildLastKnownSummary(
  snapshot: BoardSnapshot,
  origin: string,
  checkedAtMs: number,
  nowMs: number,
): string {
  const snapshotNow = new Date(snapshot.server_now).getTime()
  const lastKnownNow = Number.isFinite(snapshotNow) ? snapshotNow : checkedAtMs
  const included = snapshot.items.filter((item) => new Date(item.expires_at).getTime() > lastKnownNow)
  const lines = formatLines(included, lastKnownNow, ' at last check')
  return `LAST KNOWN - JETTYSHARE SUPPLIES\nLast checked ${lastCheckedAge(checkedAtMs, nowMs)}\n\n${lines.length ? lines.join('\n') : 'No supplies were available at the last successful check.'}\n\nLive board: ${canonicalBoardUrl(origin)}\nThis copy may be outdated - check the live board before pickup.`
}
