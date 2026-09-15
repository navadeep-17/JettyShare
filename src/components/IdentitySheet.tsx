'use client'

import { FormEvent, useState } from 'react'
import { useModalFocus } from '@/hooks/useModalFocus'
import { validateCrewLabel } from '@/lib/identity'
import { saveProfile, storageAvailable } from '@/lib/storage'

export function IdentitySheet({
  onSaved,
  onClose,
  submitLabel,
  initialLabel = '',
}: {
  onSaved: (label: string) => void
  onClose: () => void
  submitLabel: string
  initialLabel?: string
}) {
  const dialogRef = useModalFocus(onClose)
  const [label, setLabel] = useState(initialLabel)
  const [error, setError] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    let normalized = ''
    try {
      normalized = validateCrewLabel(label)
    } catch {
      setError('Enter a boat or crew name using 1–40 visible characters.')
      return
    }
    if (!storageAvailable()) {
      setError('Site storage is unavailable. Use a normal browser mode with storage enabled.')
      return
    }
    saveProfile(normalized)
    onSaved(normalized)
  }

  return <div className="overlay" role="presentation">
    <div ref={dialogRef} className="sheet" role="dialog" aria-modal="true" aria-labelledby="identity-title">
      <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
      <p className="eyebrow">ONE-TIME SETUP</p>
      <h2 id="identity-title">What should crews call your boat?</h2>
      <p className="muted">This is a local coordination label, not verified identity. No password or email is required.</p>
      <form onSubmit={submit} className="stack">
        <label>Boat / crew name<input value={label} onChange={e=>setLabel(e.target.value)} maxLength={40} placeholder="Sea Queen" aria-invalid={Boolean(error)} /></label>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="button button-primary" type="submit">{submitLabel}</button>
      </form>
    </div>
  </div>
}
