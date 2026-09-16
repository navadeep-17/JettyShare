'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useModalFocus } from '@/hooks/useModalFocus'
import { Countdown } from './Countdown'
import { adjustedNow, serverClockOffset } from '@/lib/time'
import type { ClaimReceipt } from '@/lib/types'

export function ClaimReceiptSheet({
  receipt,
  onClose,
  onHoldEnded,
}: {
  receipt: ClaimReceipt
  onClose: () => void
  onHoldEnded: () => Promise<void> | void
}) {
  const dialogRef = useModalFocus(onClose)
  const offset = useMemo(() => serverClockOffset(receipt.server_now), [receipt.server_now])
  const [nowMs, setNowMs] = useState(() => adjustedNow(offset))
  const reconciled = useRef(false)
  const holdEnded = new Date(receipt.claim_expires_at).getTime() <= nowMs
  const itemExpired = new Date(receipt.expires_at).getTime() <= nowMs

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(adjustedNow(offset)), 1000)
    return () => window.clearInterval(timer)
  }, [offset])

  useEffect(() => {
    if ((!holdEnded && !itemExpired) || reconciled.current) return
    reconciled.current = true
    void onHoldEnded()
  }, [holdEnded, itemExpired, onHoldEnded])

  return <div className="overlay" role="presentation">
    <div ref={dialogRef} className="sheet receipt" role="dialog" aria-modal="true" aria-labelledby="claim-success-title">
      <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
      <p className="success-mark">✓</p>
      <h2 id="claim-success-title">Supply claimed</h2>
      <p className="muted">Go directly to the pickup berth.</p>

      <p className="quantity receipt-quantity">{Number(receipt.quantity_value)} {receipt.quantity_unit} {receipt.item_type}</p>
      <div className="berth-panel"><span>PICKUP</span><strong>BERTH {receipt.berth}</strong></div>
      <p className="posted-by receipt-provider">Provider: {receipt.poster_label} · Claimed as {receipt.claimant_label}</p>

      <div className="receipt-grid receipt-grid-three">
        <div><span>HOLD ENDS</span><strong><Countdown expiresAt={receipt.claim_expires_at} nowMs={nowMs} /></strong></div>
        <div><span>SPOILS</span><strong><Countdown expiresAt={receipt.expires_at} nowMs={nowMs} /></strong></div>
        <div><span>HOLD UNTIL</span><strong>{new Date(receipt.claim_expires_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</strong></div>
      </div>

      <p className="hold-note">The reservation never extends beyond spoil time. To release it early, use <strong>Activity → My Claims</strong>.</p>
      {(holdEnded || itemExpired) && <div className="banner warning" role="status">Reservation is no longer current. Checking the authoritative state now.</div>}
      <div className="receipt-actions">
        <button className="button button-primary" onClick={onClose}>Done — back to board</button>
      </div>
    </div>
  </div>
}
