'use client'

import { FormEvent, useState } from 'react'
import { useModalFocus } from '@/hooks/useModalFocus'
import { createListing, JettyError } from '@/lib/api'
import { newListingId, randomCapability } from '@/lib/capabilities'
import { removeOwnedListing, setOwnedListing, storageAvailable } from '@/lib/storage'
import type { CreateListingInput, ItemType, QuantityUnit } from '@/lib/types'

type PendingAttempt = {
  listingId: string
  ownerToken: string
  payload: CreateListingInput
}

export function PostSheet({ crewLabel, onClose, onPosted }: { crewLabel: string; onClose: () => void; onPosted: () => Promise<unknown> | unknown }) {
  const dialogRef = useModalFocus(onClose)
  const [itemType, setItemType] = useState<ItemType>('ICE')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState<QuantityUnit>('KG')
  const [berth, setBerth] = useState('')
  const [spoil, setSpoil] = useState<number | null>(null)
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState<PendingAttempt | null>(null)

  const locked = Boolean(attempt)

  function chooseType(next: ItemType) {
    if (locked) return
    setItemType(next)
    setUnit(next === 'ICE' ? 'KG' : 'BUCKET')
  }

  async function sendAttempt(current: PendingAttempt) {
    setBusy(true)
    setError('')
    try {
      await createListing(current.payload, current.listingId, current.ownerToken)
      setOwnedListing(current.listingId, {
        ownerToken: current.ownerToken,
        state: 'managed',
        createdLocallyAt: new Date().toISOString(),
      })
      await onPosted()
      onClose()
    } catch (err) {
      const typed = err instanceof JettyError ? err : null
      if (typed && ['INVALID_INPUT', 'CONFLICT'].includes(typed.code)) {
        removeOwnedListing(current.listingId)
        setAttempt(null)
        setError('The post was rejected before it could become active. Review the fields and try again.')
      } else {
        setError('Connection interrupted. This exact post attempt is saved. Retry it here or recover it later from Activity.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (attempt) {
      await sendAttempt(attempt)
      return
    }

    const q = Number(quantity)
    if (!Number.isFinite(q) || q <= 0 || !/^\d+(\.\d{1,2})?$/.test(quantity.trim())) {
      setError('Enter a positive quantity with up to 2 decimal places.')
      return
    }
    if (berth.trim().length < 1 || berth.trim().length > 12) {
      setError('Berth must be 1–12 characters.')
      return
    }
    if (spoil === null) {
      setError('Choose how soon this supply will spoil.')
      return
    }
    const minutes = spoil === 0 ? Number(custom) : spoil
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 360) {
      setError('Spoil time must be 5–360 minutes.')
      return
    }
    if (!storageAvailable()) {
      setError('Site storage is required to post safely. Use a normal browser mode with storage enabled.')
      return
    }

    const payload: CreateListingInput = {
      itemType,
      quantityValue: q,
      quantityUnit: unit,
      berth: berth.trim().toUpperCase(),
      spoilMinutes: minutes,
      posterLabel: crewLabel,
    }
    const current: PendingAttempt = {
      listingId: newListingId(),
      ownerToken: randomCapability(),
      payload,
    }
    setOwnedListing(current.listingId, {
      ownerToken: current.ownerToken,
      state: 'pending-create',
      createPayload: current.payload,
      createdLocallyAt: new Date().toISOString(),
    })
    setAttempt(current)
    await sendAttempt(current)
  }

  const units: QuantityUnit[] = itemType === 'ICE' ? ['KG', 'BOX'] : ['BUCKET', 'TRAY', 'BOX']

  return <div className="overlay" role="presentation">
    <div ref={dialogRef} className="sheet" role="dialog" aria-modal="true" aria-labelledby="post-title">
      <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
      <p className="eyebrow">QUICK POST</p>
      <h2 id="post-title">Share surplus supply</h2>
      <p className="muted">Posting as <strong>{crewLabel}</strong>. Change the local label from Activity for future posts.</p>
      <form onSubmit={submit} className="stack">
        <fieldset disabled={locked || busy}>
          <legend>What are you sharing?</legend>
          <div className="segmented">
            <button type="button" aria-pressed={itemType === 'ICE'} className={itemType === 'ICE' ? 'selected' : ''} onClick={()=>chooseType('ICE')}>ICE</button>
            <button type="button" aria-pressed={itemType === 'BAIT'} className={itemType === 'BAIT' ? 'selected' : ''} onClick={()=>chooseType('BAIT')}>BAIT</button>
          </div>
        </fieldset>
        <div className="field-row">
          <label>Quantity<input disabled={locked || busy} inputMode="decimal" value={quantity} onChange={e=>setQuantity(e.target.value)} placeholder="20" /></label>
          <label>Unit<select disabled={locked || busy} value={unit} onChange={e=>setUnit(e.target.value as QuantityUnit)}>{units.map(x=><option key={x}>{x}</option>)}</select></label>
        </div>
        <label>Pickup berth<input disabled={locked || busy} value={berth} onChange={e=>setBerth(e.target.value.toUpperCase())} maxLength={12} placeholder="08" /></label>
        <fieldset disabled={locked || busy}>
          <legend>Spoils in</legend>
          <div className="chips">
            {[15, 30, 60, 120].map(m=><button type="button" key={m} aria-pressed={spoil === m} className={spoil === m ? 'selected' : ''} onClick={()=>setSpoil(m)}>{m < 60 ? `${m}m` : `${m / 60}h`}</button>)}
            <button type="button" aria-pressed={spoil === 0} className={spoil === 0 ? 'selected' : ''} onClick={()=>setSpoil(0)}>Custom</button>
          </div>
        </fieldset>
        {spoil === 0 && <label>Custom minutes<input disabled={locked || busy} inputMode="numeric" value={custom} onChange={e=>setCustom(e.target.value)} placeholder="45" /></label>}
        {attempt && <div className="banner warning">Pending post is locked to its original details so retry cannot create a duplicate.</div>}
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="button button-primary" disabled={busy}>{busy ? 'Posting…' : attempt ? 'Retry same post' : 'Post supply'}</button>
      </form>
    </div>
  </div>
}
