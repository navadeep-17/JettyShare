'use client'

import { FormEvent, useState } from 'react'
import { saveProfile, storageAvailable } from '@/lib/storage'

export function IdentitySheet({
  onSaved,
  onClose,
  submitLabel,
}: {
  onSaved: (label: string) => void
  onClose: () => void
  submitLabel: string
}) {
  const [label, setLabel] = useState('')
  const [error, setError] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    const normalized = label.trim()
    if (normalized.length < 1 || normalized.length > 40) {
      setError('Enter a boat or crew name (1–40 characters).')
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
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="identity-title">
      <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
      <p className="eyebrow">ONE-TIME SETUP</p>
      <h2 id="identity-title">What should crews call your boat?</h2>
      <p className="muted">This is a local coordination label, not verified identity. No password or email is required.</p>
      <form onSubmit={submit} className="stack">
        <label>Boat / crew name<input autoFocus value={label} onChange={e=>setLabel(e.target.value)} maxLength={40} placeholder="Sea Queen" /></label>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="button button-primary" type="submit">{submitLabel}</button>
      </form>
    </div>
  </div>
}
