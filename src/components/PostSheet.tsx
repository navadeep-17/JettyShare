'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
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

type FieldErrors = Partial<Record<'quantity' | 'berth' | 'spoil' | 'custom', string>>

export function PostSheet({ crewLabel, onClose, onPosted }: { crewLabel: string; onClose: () => void; onPosted: () => Promise<unknown> | unknown }) {
  const dialogRef = useModalFocus(onClose)
  const quantityRef = useRef<HTMLInputElement | null>(null)
  const berthRef = useRef<HTMLInputElement | null>(null)
  const spoilRef = useRef<HTMLButtonElement | null>(null)
  const customRef = useRef<HTMLInputElement | null>(null)
  const requestInFlight = useRef(false)
  const [itemType, setItemType] = useState<ItemType>('ICE')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState<QuantityUnit>('KG')
  const [berth, setBerth] = useState('')
  const [spoil, setSpoil] = useState<number | null>(null)
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [attempt, setAttempt] = useState<PendingAttempt | null>(null)

  const locked = Boolean(attempt)

  useEffect(() => {
    const shell = document.querySelector('.app-shell')
    if (!shell) return

    const background = Array.from(shell.children)
      .filter((element) => !element.classList.contains('overlay')) as HTMLElement[]
    const previous = background.map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute('aria-hidden'),
    }))

    for (const element of background) {
      element.inert = true
      element.setAttribute('aria-hidden', 'true')
    }

    return () => {
      for (const entry of previous) {
        entry.element.inert = entry.inert
        if (entry.ariaHidden === null) entry.element.removeAttribute('aria-hidden')
        else entry.element.setAttribute('aria-hidden', entry.ariaHidden)
      }
    }
  }, [])

  function clearFieldError(field: keyof FieldErrors) {
    setFieldErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  function chooseType(next: ItemType) {
    if (locked) return
    setItemType(next)
    setUnit(next === 'ICE' ? 'KG' : 'BUCKET')
  }

  async function sendAttempt(current: PendingAttempt) {
    if (requestInFlight.current) return
    requestInFlight.current = true
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
        setError('The post was rejected before it could become active. Review the fields and try again with a new safe attempt.')
      } else {
        setError('Connection interrupted. This exact post attempt is saved. Retry it here or recover it later from Activity.')
      }
    } finally {
      requestInFlight.current = false
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

    const nextErrors: FieldErrors = {}
    const qText = quantity.trim()
    const q = Number(qText)
    if (!Number.isFinite(q) || q <= 0 || !/^\d+(\.\d{1,2})?$/.test(qText)) {
      nextErrors.quantity = 'Enter a positive quantity with up to 2 decimal places.'
    }

    const normalizedBerth = berth.trim()
    if (normalizedBerth.length < 1 || normalizedBerth.length > 12) {
      nextErrors.berth = 'Berth must be 1–12 characters.'
    }

    let minutes: number | null = null
    if (spoil === null) {
      nextErrors.spoil = 'Choose how soon this supply will spoil.'
    } else {
      minutes = spoil === 0 ? Number(custom.trim()) : spoil
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 360) {
        if (spoil === 0) nextErrors.custom = 'Enter 5 to 360 whole minutes.'
        else nextErrors.spoil = 'Spoil time must be 5–360 minutes.'
      }
    }

    setFieldErrors(nextErrors)
    const firstInvalid = (['quantity', 'berth', 'spoil', 'custom'] as const).find((field) => nextErrors[field])
    if (firstInvalid) {
      window.requestAnimationFrame(() => {
        const target = firstInvalid === 'quantity'
          ? quantityRef.current
          : firstInvalid === 'berth'
            ? berthRef.current
            : firstInvalid === 'custom'
              ? customRef.current
              : spoilRef.current
        target?.focus()
        target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      })
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
      berth: normalizedBerth,
      spoilMinutes: minutes as number,
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
    <div ref={dialogRef} className="sheet" role="dialog" aria-modal="true" aria-labelledby="post-title" aria-busy={busy}>
      <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
      <p className="eyebrow">QUICK POST</p>
      <h2 id="post-title">Share surplus supply</h2>
      <p className="muted">Posting as <strong>{crewLabel}</strong>. Change the local label from Activity for future posts.</p>
      <form onSubmit={submit} className="stack" noValidate>
        <fieldset disabled={locked || busy}>
          <legend>What are you sharing?</legend>
          <div className="segmented">
            <button type="button" aria-pressed={itemType === 'ICE'} className={itemType === 'ICE' ? 'selected' : ''} onClick={()=>chooseType('ICE')}>ICE</button>
            <button type="button" aria-pressed={itemType === 'BAIT'} className={itemType === 'BAIT' ? 'selected' : ''} onClick={()=>chooseType('BAIT')}>BAIT</button>
          </div>
        </fieldset>

        <div className="field-row">
          <label>Quantity
            <input
              ref={quantityRef}
              disabled={locked || busy}
              inputMode="decimal"
              value={quantity}
              onChange={(event)=>{setQuantity(event.target.value);clearFieldError('quantity')}}
              aria-invalid={Boolean(fieldErrors.quantity)}
              aria-describedby={fieldErrors.quantity ? 'quantity-error' : undefined}
              placeholder="20"
            />
            {fieldErrors.quantity && <span id="quantity-error" className="error-text" role="alert">ERROR · {fieldErrors.quantity}</span>}
          </label>
          <label>Unit
            <select disabled={locked || busy} value={unit} onChange={e=>setUnit(e.target.value as QuantityUnit)}>{units.map(x=><option key={x}>{x}</option>)}</select>
          </label>
        </div>

        <label>Pickup berth
          <input
            ref={berthRef}
            disabled={locked || busy}
            value={berth}
            onChange={(event)=>{setBerth(event.target.value);clearFieldError('berth')}}
            aria-invalid={Boolean(fieldErrors.berth)}
            aria-describedby={fieldErrors.berth ? 'berth-error' : undefined}
            placeholder="J-08"
          />
          {fieldErrors.berth && <span id="berth-error" className="error-text" role="alert">ERROR · {fieldErrors.berth}</span>}
        </label>

        <fieldset disabled={locked || busy} aria-describedby={fieldErrors.spoil ? 'spoil-error' : undefined}>
          <legend>Spoils in</legend>
          <div className="chips">
            {[15, 30, 60, 120].map((m, index)=><button ref={index === 0 ? spoilRef : undefined} type="button" key={m} aria-pressed={spoil === m} className={spoil === m ? 'selected' : ''} onClick={()=>{setSpoil(m);clearFieldError('spoil');clearFieldError('custom')}}>{m < 60 ? `${m}m` : `${m / 60}h`}</button>)}
            <button type="button" aria-pressed={spoil === 0} className={spoil === 0 ? 'selected' : ''} onClick={()=>{setSpoil(0);clearFieldError('spoil')}}>Custom</button>
          </div>
          {fieldErrors.spoil && <span id="spoil-error" className="error-text" role="alert">ERROR · {fieldErrors.spoil}</span>}
        </fieldset>

        {spoil === 0 && <label>Custom minutes
          <input
            ref={customRef}
            disabled={locked || busy}
            inputMode="numeric"
            value={custom}
            onChange={(event)=>{setCustom(event.target.value);clearFieldError('custom')}}
            aria-invalid={Boolean(fieldErrors.custom)}
            aria-describedby={fieldErrors.custom ? 'custom-error' : undefined}
            placeholder="45"
          />
          {fieldErrors.custom && <span id="custom-error" className="error-text" role="alert">ERROR · {fieldErrors.custom}</span>}
        </label>}

        {attempt && <div className="banner warning">Pending post is locked to its original details so retry cannot create a duplicate.</div>}
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="button button-primary" disabled={busy}>{busy ? 'Posting…' : attempt ? 'Retry same post' : 'Post supply'}</button>
      </form>
    </div>
  </div>
}
