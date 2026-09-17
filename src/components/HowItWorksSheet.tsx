'use client'

import { useModalFocus } from '@/hooks/useModalFocus'

export function HowItWorksSheet({ onClose }: { onClose: () => void }) {
  const dialogRef = useModalFocus(onClose)

  return <div className="overlay" role="presentation">
    <div ref={dialogRef} className="sheet how-it-works-sheet" role="dialog" aria-modal="true" aria-labelledby="how-it-works-title">
      <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
      <p className="eyebrow">BUILT FOR THE JETTY</p>
      <h2 id="how-it-works-title">From surplus to pickup in three steps</h2>
      <p className="muted how-intro">JettyShare keeps the handoff intentionally short so crews can act quickly even on a busy dock or a slow connection.</p>

      <ol className="how-steps">
        <li>
          <span className="how-step-number" aria-hidden="true">1</span>
          <div><strong>Post surplus</strong><span>Share ice or bait with quantity, berth and spoil time. If it is no longer available, withdraw it from Activity.</span></div>
        </li>
        <li>
          <span className="how-step-number" aria-hidden="true">2</span>
          <div><strong>Claim instantly</strong><span>One crew gets the reservation; competing claims cannot both win.</span></div>
        </li>
        <li>
          <span className="how-step-number" aria-hidden="true">3</span>
          <div><strong>Verify & hand over</strong><span>The claimant shows their four-digit pickup code. The provider verifies that current reservation before confirming collection.</span></div>
        </li>
      </ol>

      <div className="scope-note">
        <strong>Activity stays device-local</strong>
        <span>Current posts and claims keep their capability controls. Recent completed activity keeps only non-secret handoff details on this browser.</span>
      </div>

      <div className="scope-note">
        <strong>Deliberately lightweight</strong>
        <span>No accounts · No OTPs · No payments · No chat · Just the authority needed for a fast, verifiable handoff.</span>
      </div>

      <button className="button button-primary how-done" onClick={onClose}>Got it</button>
    </div>
  </div>
}
