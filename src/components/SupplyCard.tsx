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
  const urgencyClass = countdown.expired ? 'urgent' : countdown.band.toLowerCase()

  return <article className={`supply-card supply-card-${urgencyClass}`} aria-label={`${item.item_type} ${quantity(item)} at berth ${item.berth}, ${remaining}`}>
    <div className="card-top">
      <Countdown expiresAt={item.expires_at} nowMs={nowMs} />
      {own && <span className="status status-info">YOUR POST</span>}
    </div>

    <div className="item-line">
      <span className={`item-icon item-icon-${item.item_type.toLowerCase()}`} aria-hidden="true">
        {item.item_type === 'ICE'
          ? <svg viewBox="0 0 32 32"><path d="M16 4v24M6 10l20 12M26 10 6 22M10 6l6 4 6-4M10 26l6-4 6 4M5 15l5 3-1 6M27 15l-5 3 1 6" /></svg>
          : <svg viewBox="0 0 32 32"><path d="M6 17c4-7 11-9 18-5l4-4v8l-4-4c-1 8-9 12-18 5Zm5-1h.01" /></svg>}
      </span>
      <div>
        <p className="item-kicker">FRESH SURPLUS</p>
        <h3>{item.item_type === 'ICE' ? 'ICE' : 'LIVE BAIT'}</h3>
      </div>
    </div>

    <div className="quantity-block">
      <span className="fact-label">AVAILABLE</span>
      <p className="quantity">{quantity(item)}</p>
    </div>

    <div className="pickup-panel">
      <p className="pickup-label">PICKUP AT</p>
      <p className="berth">BERTH {item.berth}</p>
    </div>

    <p className="posted-by">Posted by {item.poster_label}</p>
    {own
      ? <div className="own-listing-note" role="status">Your listing — manage it in Activity.</div>
      : <button className="button button-primary" disabled={pending} onClick={onClaim} aria-label={`Claim ${quantity(item)} ${item.item_type} at Berth ${item.berth}`}>
          {pending ? 'Claiming…' : 'Claim'}
        </button>}
  </article>
}
