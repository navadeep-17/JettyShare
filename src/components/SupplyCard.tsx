'use client'

import { Countdown } from './Countdown'
import { boardCountdown } from '@/lib/time'
import type { ActiveBoardItem } from '@/lib/types'

function quantity(item: ActiveBoardItem) {
  const value = Number(item.quantity_value).toString()
  const unit = item.quantity_unit === 'KG' ? 'kg' : item.quantity_unit.toLowerCase()
  const plural = Number(item.quantity_value) === 1 || item.quantity_unit === 'KG' ? '' : 's'
  return `${value} ${unit}${plural}`
}

export function SupplyCard({
  item,
  own,
  pending,
  nowMs,
  onClaim,
}: {
  item: ActiveBoardItem
  own: boolean
  pending: boolean
  nowMs: number
  onClaim: () => void
}) {
  const countdown = boardCountdown(item.expires_at, nowMs)
  const remaining = countdown.expired ? 'expired' : `${countdown.band.toLowerCase()}, ${countdown.text}`

  return <article className="supply-card" aria-label={`${item.item_type} ${quantity(item)} at berth ${item.berth}, ${remaining}`}>
    <div className="card-top"><Countdown expiresAt={item.expires_at} nowMs={nowMs} />{own && <span className="status status-info">YOUR POST</span>}</div>
    <div className="item-line"><span className="item-icon" aria-hidden>{item.item_type === 'ICE' ? '◆' : '●'}</span><h3>{item.item_type === 'ICE' ? 'ICE' : 'LIVE BAIT'}</h3></div>
    <p className="quantity">{quantity(item)}</p>
    <p className="pickup-label">PICKUP</p><p className="berth">BERTH {item.berth}</p>
    <p className="posted-by">Posted by {item.poster_label}</p>
    {own
      ? <div className="own-listing-note" role="status">Your listing — manage it in Activity.</div>
      : <button className="button button-primary" disabled={pending} onClick={onClaim} aria-label={`Claim ${quantity(item)} ${item.item_type} at Berth ${item.berth}`}>
          {pending ? 'Claiming…' : 'Claim'}
        </button>}
  </article>
}
