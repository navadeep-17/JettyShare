'use client'

import { useMemo, useState } from 'react'
import { claimListing, releaseClaim, JettyError } from '@/lib/api'
import { newClaimVersion, randomCapability } from '@/lib/capabilities'
import { getClaims, getOwnedListings, getProfile, removeClaim, setClaim, storageAvailable } from '@/lib/storage'
import { buildShareSummary } from '@/lib/summary'
import type { ActiveBoardItem, ClaimReceipt } from '@/lib/types'
import { useLiveBoard } from '@/hooks/useLiveBoard'
import { IdentitySheet } from './IdentitySheet'
import { PostSheet } from './PostSheet'
import { SupplyCard } from './SupplyCard'
import { ClaimReceiptSheet } from './ClaimReceiptSheet'
import { MyActivitySheet } from './MyActivitySheet'
import { CopyFallbackSheet } from './CopyFallbackSheet'

type Filter = 'ALL' | 'ICE' | 'BAIT'
type PendingAction = { type: 'post' } | { type: 'claim'; item: ActiveBoardItem }

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

export function JettyShareApp() {
  const { snapshot, loading, degraded, lastSuccessAt, refresh } = useLiveBoard()
  const [filter, setFilter] = useState<Filter>('ALL')
  const [identityAction, setIdentityAction] = useState<PendingAction | null>(null)
  const [postLabel, setPostLabel] = useState<string | null>(null)
  const [claimingId, setClaimingId] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<{ receipt: ClaimReceipt; item: ActiveBoardItem } | null>(null)
  const [activityOpen, setActivityOpen] = useState(false)
  const [copyFallback, setCopyFallback] = useState<{ text: string; lastKnown: boolean } | null>(null)
  const [notice, setNotice] = useState('')

  const items = useMemo(
    () => (snapshot?.items ?? []).filter((item) => filter === 'ALL' || item.item_type === filter),
    [snapshot, filter],
  )
  const ownedIds = useMemo(
    () => typeof window === 'undefined' ? new Set<string>() : new Set(Object.keys(getOwnedListings())),
    [snapshot],
  )

  function requireIdentity(action: PendingAction) {
    const profile = getProfile()
    if (profile?.crewLabel) {
      if (action.type === 'post') setPostLabel(profile.crewLabel)
      else void performClaim(action.item, profile.crewLabel)
    } else {
      setIdentityAction(action)
    }
  }

  function identitySaved(label: string) {
    const action = identityAction
    setIdentityAction(null)
    if (!action) return
    if (action.type === 'post') setPostLabel(label)
    else void performClaim(action.item, label)
  }

  async function performClaim(item: ActiveBoardItem, crewLabel: string) {
    if (!storageAvailable()) {
      setNotice('Site storage is required to safely hold a claim. Use a normal browser mode with storage enabled.')
      return
    }

    const existing = getClaims()[item.id]
    if (existing?.state === 'held') {
      setNotice('This device already holds that supply. Open Activity to manage the reservation.')
      return
    }

    const claimVersion = existing?.state === 'pending-claim' ? existing.claimVersion : newClaimVersion()
    const claimToken = existing?.state === 'pending-claim' ? existing.claimToken : randomCapability()
    const claimantLabel = existing?.claimantLabel || crewLabel
    const requestedLocallyAt = existing?.requestedLocallyAt || new Date().toISOString()

    setClaim(item.id, {
      claimVersion,
      claimToken,
      claimantLabel,
      state: 'pending-claim',
      requestedLocallyAt,
    })
    setClaimingId(item.id)
    setNotice('')

    try {
      const backoff = [750, 2000]
      for (let requestNumber = 0; requestNumber < 3; requestNumber += 1) {
        try {
          const result = await claimListing(item.id, claimantLabel, claimVersion, claimToken)
          setClaim(item.id, {
            claimVersion,
            claimToken,
            claimantLabel,
            state: 'held',
            requestedLocallyAt,
            claimExpiresAt: result.claim_expires_at,
            itemExpiresAt: result.expires_at,
          })
          setReceipt({ receipt: result, item })
          await refresh()
          return
        } catch (error) {
          if (error instanceof JettyError && ['CLAIM_UNAVAILABLE', 'ITEM_EXPIRED', 'NOT_FOUND', 'ALREADY_COLLECTED'].includes(error.code)) {
            removeClaim(item.id)
            setNotice(error.code === 'ITEM_EXPIRED' ? 'This supply just expired.' : 'Someone else just claimed this supply.')
            await refresh()
            return
          }
          if (error instanceof JettyError && ['CLAIM_HOLD_EXPIRED', 'STALE_CLAIM_VERSION', 'CAPABILITY_INVALID'].includes(error.code)) {
            removeClaim(item.id)
            setNotice('This saved claim attempt is no longer current. The board has been refreshed.')
            await refresh()
            return
          }
          if (requestNumber < 2) {
            await sleep(backoff[requestNumber])
            continue
          }
          setNotice('Claim status is uncertain because the connection was interrupted. The exact attempt is saved for recovery in Activity.')
        }
      }
    } finally {
      setClaimingId(null)
    }
  }

  async function releaseReceiptClaim() {
    if (!receipt) return
    const saved = getClaims()[receipt.receipt.listing_id]
    if (!saved) {
      setNotice('This reservation is no longer stored on this device. Open Activity to check the latest state.')
      setReceipt(null)
      return
    }
    try {
      await releaseClaim(receipt.receipt.listing_id, saved.claimVersion, saved.claimToken)
      removeClaim(receipt.receipt.listing_id)
      setReceipt(null)
      setNotice('Claim released. The supply can return to the board if it is still fresh.')
      await refresh()
    } catch (error) {
      if (error instanceof JettyError && ['CLAIM_HOLD_EXPIRED', 'STALE_CLAIM_VERSION', 'ITEM_EXPIRED', 'ALREADY_COLLECTED', 'CLAIM_UNAVAILABLE'].includes(error.code)) {
        removeClaim(receipt.receipt.listing_id)
        setReceipt(null)
        setNotice('That reservation has already ended. The board has been refreshed.')
        await refresh()
      } else {
        setNotice('Connection interrupted while releasing. The reservation was kept locally so Activity can reconcile it safely.')
      }
    }
  }

  async function copySummary() {
    let source = snapshot
    let lastKnown = false

    const stale = !lastSuccessAt || Date.now() - lastSuccessAt > 60000
    if (degraded || stale) {
      const fresh = await refresh()
      if (fresh) source = fresh
      else if (source) lastKnown = true
    }

    if (!source) {
      setNotice('Could not load the live board, so no supply summary was copied.')
      return
    }

    const text = buildShareSummary(source, window.location.origin, Date.now(), lastKnown)
    if (lastKnown) {
      setCopyFallback({ text, lastKnown: true })
      return
    }

    try {
      await navigator.clipboard.writeText(text)
      setNotice('Available supplies copied.')
    } catch {
      setCopyFallback({ text, lastKnown: false })
    }
  }

  return <main className="app-shell">
    <header className="topbar">
      <div>
        <p className="eyebrow">COASTAL JETTY BOARD</p>
        <h1>JettyShare</h1>
        <p className="subtitle">Fresh surplus. Fast pickup. Less waste.</p>
      </div>
      <div className="top-actions">
        <button className="button compact" onClick={()=>setActivityOpen(true)}>Activity</button>
        <button className="button button-primary compact" onClick={()=>requireIdentity({ type: 'post' })}>+ Post</button>
      </div>
    </header>

    {degraded && <div className="banner warning">Live updates are degraded — the board will keep reconciling automatically.</div>}
    {notice && <div className="banner" role="status">{notice}<button onClick={()=>setNotice('')} aria-label="Dismiss">×</button></div>}

    <section className="board-tools">
      <div className="filters" role="group" aria-label="Filter supplies">
        {(['ALL', 'ICE', 'BAIT'] as Filter[]).map((value)=><button key={value} className={filter === value ? 'selected' : ''} onClick={()=>setFilter(value)}>{value === 'ALL' ? 'All' : value === 'ICE' ? 'Ice' : 'Bait'}</button>)}
      </div>
      <button className="copy-button" onClick={()=>void copySummary()}>Copy all available</button>
    </section>

    <div className="section-heading">
      <div><p className="eyebrow">AVAILABLE NOW</p><h2>Urgent supply first</h2></div>
      <button className="link-button" onClick={()=>void refresh()}>Refresh</button>
    </div>

    {loading && !snapshot
      ? <div className="empty">Loading available supplies…</div>
      : items.length === 0
        ? <div className="empty"><strong>{snapshot?.items.length ? 'No supplies match this filter.' : 'No supplies available right now.'}</strong><span>Returning crews can post surplus ice or bait in seconds.</span></div>
        : <div className="supply-list">{items.map((item)=><SupplyCard key={item.id} item={item} own={ownedIds.has(item.id)} pending={claimingId === item.id} onClaim={()=>requireIdentity({ type: 'claim', item })} />)}</div>}

    <button className="floating-post" onClick={()=>requireIdentity({ type: 'post' })}>+ POST SUPPLY</button>

    {identityAction && <IdentitySheet submitLabel={identityAction.type === 'claim' ? 'Save & Claim' : 'Save & Post'} onClose={()=>setIdentityAction(null)} onSaved={identitySaved} />}
    {postLabel && <PostSheet crewLabel={postLabel} onClose={()=>setPostLabel(null)} onPosted={refresh} />}
    {receipt && <ClaimReceiptSheet receipt={receipt.receipt} item={receipt.item} onClose={()=>setReceipt(null)} onRelease={releaseReceiptClaim} />}
    {activityOpen && <MyActivitySheet onClose={()=>setActivityOpen(false)} onChanged={refresh} />}
    {copyFallback && <CopyFallbackSheet text={copyFallback.text} lastKnown={copyFallback.lastKnown} onClose={()=>setCopyFallback(null)} />}
  </main>
}
