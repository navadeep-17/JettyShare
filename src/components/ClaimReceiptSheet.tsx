'use client'

import { Countdown } from './Countdown'
import type { ActiveBoardItem, ClaimReceipt } from '@/lib/types'

export function ClaimReceiptSheet({ receipt, item, onClose }: { receipt: ClaimReceipt; item: ActiveBoardItem; onClose: () => void }) {
  return <div className="overlay"><div className="sheet receipt" role="dialog" aria-modal="true" aria-labelledby="claim-success-title">
    <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
    <p className="success-mark">✓</p><h2 id="claim-success-title">Supply claimed</h2>
    <p className="muted">Go directly to the pickup berth.</p>
    <div className="berth-panel"><span>PICKUP</span><strong>BERTH {receipt.berth}</strong></div>
    <div className="receipt-grid"><div><span>Supply</span><strong>{item.quantity_value} {item.quantity_unit} {item.item_type}</strong></div><div><span>Spoils</span><strong><Countdown expiresAt={receipt.expires_at} /></strong></div></div>
    <p className="hold-note">Your reservation is held until {new Date(receipt.claim_expires_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} or until the supply spoils, whichever comes first.</p>
    <button className="button button-primary" onClick={onClose}>Back to board</button>
  </div></div>
}
