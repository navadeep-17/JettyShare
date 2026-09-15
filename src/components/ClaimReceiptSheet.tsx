'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useModalFocus } from '@/hooks/useModalFocus'
import { Countdown } from './Countdown'
import { adjustedNow, serverClockOffset } from '@/lib/time'
import type { ActiveBoardItem, ClaimReceipt } from '@/lib/types'

export function ClaimReceiptSheet({
  receipt,
  item,
  onClose,
  onRelease,
  onHoldEnded,
}: {
  receipt: ClaimReceipt
  item: ActiveBoardItem
  onClose: () => void
  onRelease: () => Promise<void>
  onHoldEnded: () => Promise<void> | void
}) {
  const dialogRef = useModalFocus(onClose)
  const offset = useMemo(() => serverClockOffset(receipt.server_now), [receipt.server_now])
  const [nowMs, setNowMs] = useState(() => adjustedNow(offset))
  const [releasing, setReleasing] = useState(false)
  const reconciled = useRef(false)
  const holdEnded = new Date(receipt.claim_expires_at).getTime() <= nowMs

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(adjustedNow(offset)), 1000)
    return () => window.clearInterval(timer)
  }, [offset])

  useEffect(() => {
    if (!holdEnded || reconciled.current) return
    reconciled.current = true
    void onHoldEnded()
  }, [holdEnded, onHoldEnded])

  async function release() {
    if (holdEnded) return
    if (!window.confirm('Release this claim? The supply will become available to other boats.')) return
    setReleasing(true)
    try { await onRelease() } finally { setReleasing(false) }
  }

  return <div className="overlay" role="presentation">
    <div ref={dialogRef} className="sheet receipt" role="dialog" aria-modal="true" aria-labelledby="claim-success-title">
      <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
      <p className="success-mark">✓</p>
      <h2 id="claim-success-title">Supply claimed</h2>
      <p className="muted">Go directly to the pickup berth.</p>
      <div className="berth-panel"><span>PICKUP</span><strong>BERTH {receipt.berth}</strong></div>
      <p className="posted-by receipt-provider">Provider: {item.poster_label}</p>
      <div className="receipt-grid receipt-grid-three">
        <div><span>Supply</span><strong>{item.quantity_value} {item.quantity_unit} {item.item_type}</strong></div>
        <div><span>HOLD ENDS</span><strong><Countdown expiresAt={receipt.claim_expires_at} nowMs={nowMs} /></strong></div>
        <div><span>SPOILS</span><strong><Countdown expiresAt={receipt.expires_at} nowMs={nowMs} /></strong></div>
      </div>
      <p className="hold-note">Reservation deadline: {new Date(receipt.claim_expires_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. The hold never extends beyond spoil time.</p>
      {holdEnded && <div className="banner warning" role="status">Reservation hold ended. Checking the latest board state.</div>}
      <div className="receipt-actions">
        <button className="button button-primary" onClick={onClose}>Back to board</button>
        <button className="button" disabled={releasing || holdEnded} onClick={()=>void release()}>{releasing ? 'Releasing…' : holdEnded ? 'Reservation ended' : 'I can’t make it — release'}</button>
      </div>
    </div>
  </div>
}
