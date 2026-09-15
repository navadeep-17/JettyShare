'use client'

import { FormEvent, useState } from 'react'
import { createListing, JettyError } from '@/lib/api'
import { newListingId, randomCapability } from '@/lib/capabilities'
import { setOwnedListing } from '@/lib/storage'
import type { CreateListingInput, ItemType, QuantityUnit } from '@/lib/types'

export function PostSheet({ crewLabel, onClose, onPosted }: { crewLabel: string; onClose: () => void; onPosted: () => Promise<void> | void }) {
  const [itemType, setItemType] = useState<ItemType>('ICE')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState<QuantityUnit>('KG')
  const [berth, setBerth] = useState('')
  const [spoil, setSpoil] = useState(30)
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function chooseType(next: ItemType) { setItemType(next); setUnit(next === 'ICE' ? 'KG' : 'BUCKET') }

  async function submit(e: FormEvent) {
    e.preventDefault(); setError('')
    const q = Number(quantity); const minutes = spoil === 0 ? Number(custom) : spoil
    if (!Number.isFinite(q) || q <= 0 || !/^\d+(\.\d{1,2})?$/.test(quantity.trim())) return setError('Enter a positive quantity with up to 2 decimal places.')
    if (berth.trim().length < 1 || berth.trim().length > 12) return setError('Berth must be 1–12 characters.')
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 360) return setError('Spoil time must be 5–360 minutes.')
    const payload: CreateListingInput = { itemType, quantityValue: q, quantityUnit: unit, berth: berth.trim(), spoilMinutes: minutes, posterLabel: crewLabel }
    const listingId = newListingId(); const ownerToken = randomCapability()
    setOwnedListing(listingId, { ownerToken, state: 'pending-create', createPayload: payload, createdLocallyAt: new Date().toISOString() })
    setBusy(true)
    try {
      await createListing(payload, listingId, ownerToken)
      setOwnedListing(listingId, { ownerToken, state: 'managed', createdLocallyAt: new Date().toISOString() })
      await onPosted(); onClose()
    } catch (err) {
      const typed = err instanceof JettyError ? err : null
      if (typed && typed.code !== 'NETWORK') setError('Could not post this supply. Check the fields and try again.')
      else setError('Connection interrupted. Your pending post was kept safely; retry support will reuse the same attempt.')
    } finally { setBusy(false) }
  }

  const units: QuantityUnit[] = itemType === 'ICE' ? ['KG','BOX'] : ['BUCKET','TRAY','BOX']
  return <div className="overlay"><div className="sheet" role="dialog" aria-modal="true" aria-labelledby="post-title">
    <button className="sheet-close" onClick={onClose} aria-label="Close">×</button><p className="eyebrow">QUICK POST</p><h2 id="post-title">Share surplus supply</h2>
    <form onSubmit={submit} className="stack">
      <fieldset><legend>What are you sharing?</legend><div className="segmented"><button type="button" className={itemType==='ICE'?'selected':''} onClick={()=>chooseType('ICE')}>ICE</button><button type="button" className={itemType==='BAIT'?'selected':''} onClick={()=>chooseType('BAIT')}>BAIT</button></div></fieldset>
      <div className="field-row"><label>Quantity<input inputMode="decimal" value={quantity} onChange={e=>setQuantity(e.target.value)} placeholder="20" /></label><label>Unit<select value={unit} onChange={e=>setUnit(e.target.value as QuantityUnit)}>{units.map(x=><option key={x}>{x}</option>)}</select></label></div>
      <label>Pickup berth<input value={berth} onChange={e=>setBerth(e.target.value.toUpperCase())} maxLength={12} placeholder="08" /></label>
      <fieldset><legend>Spoils in</legend><div className="chips">{[15,30,60,120].map(m=><button type="button" key={m} className={spoil===m?'selected':''} onClick={()=>setSpoil(m)}>{m<60?`${m}m`:`${m/60}h`}</button>)}<button type="button" className={spoil===0?'selected':''} onClick={()=>setSpoil(0)}>Custom</button></div></fieldset>
      {spoil===0 && <label>Custom minutes<input inputMode="numeric" value={custom} onChange={e=>setCustom(e.target.value)} placeholder="45" /></label>}
      {error && <p className="error-text">{error}</p>}<button className="button button-primary" disabled={busy}>{busy?'Posting…':'Post supply'}</button>
    </form>
  </div></div>
}
