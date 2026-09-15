'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { claimListing, getClaimReceipt, releaseClaim, JettyError } from '@/lib/api'
import { newClaimVersion, randomCapability } from '@/lib/capabilities'
import { getClaims, getOwnedListings, getProfile, removeClaim, setClaim, storageAvailable } from '@/lib/storage'
import { activeSummaryItems, buildLastKnownSummary, buildShareSummary } from '@/lib/summary'
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
  const {
    snapshot,
    loading,
    initialError,
    degraded,
    lastSuccessAt,
    clockNowMs,
    refresh,
  } = useLiveBoard()
  const [filter, setFilter] = useState<Filter>('ALL')
  const [identityAction, setIdentityAction] = useState<PendingAction | null>(null)
  const [postLabel, setPostLabel] = useState<string | null>(null)
  const [claimingId, setClaimingId] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<{ receipt: ClaimReceipt; item: ActiveBoardItem } | null>(null)
  const [activityOpen, setActivityOpen] = useState(false)
  const [copyFallback, setCopyFallback] = useState<{ text: string; lastKnown: boolean } | null>(null)
  const [lastKnownOffer, setLastKnownOffer] = useState<string | null>(null)
  const [copyBusy, setCopyBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const liveItems = useMemo(
    () => (snapshot?.items ?? []).filter((item) => new Date(item.expires_at).getTime() > clockNowMs),
    [snapshot, clockNowMs],
  )
  const items = useMemo(
    () => liveItems.filter((item) => filter === 'ALL' || item.item_type === filter),
    [liveItems, filter],
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

  const recoverPendingClaims = useCallback(async () => {
    if (typeof window === 'undefined' || !navigator.onLine) return
    const pending = Object.entries(getClaims()).filter(([, claim]) => claim.state === 'pending-claim')
    if (!pending.length) return

    for (const [listingId, saved] of pending) {
      try {
        const current = await getClaimReceipt(listingId, saved.claimVersion, saved.claimToken) as any
        if (current?.effective_status === 'CLAIMED') {
          setClaim(listingId, {
            ...saved,
            state: 'held',
            claimExpiresAt: current.claim_expires_at,
            itemExpiresAt: current.expires_at,
          })
          setNotice(`Claim recovered — pickup at BERTH ${current.berth}. Open Activity for the current reservation.`)
          await refresh()
          continue
        }
      } catch (error) {
        const code = error instanceof JettyError ? error.code : 'NETWORK'
        if (!['STALE_CLAIM_VERSION', 'NETWORK'].includes(code)) {
          if (['ITEM_EXPIRED', 'NOT_FOUND', 'ALREADY_COLLECTED', 'CLAIM_HOLD_EXPIRED', 'CAPABILITY_INVALID'].includes(code)) {
            removeClaim(listingId)
            await refresh()
          }
          continue
        }
        if (code === 'NETWORK') continue
      }

      try {
        const result = await claimListing(listingId, saved.claimantLabel || getProfile()?.crewLabel || '', saved.claimVersion, saved.claimToken)
        setClaim(listingId, {
          ...saved,
          state: 'held',
          claimExpiresAt: result.claim_expires_at,
          itemExpiresAt: result.expires_at,
        })
        setNotice(`Claim recovered — pickup at BERTH ${result.berth}. Open Activity for the current reservation.`)
        await refresh()
      } catch (error) {
        const code = error instanceof JettyError ? error.code : 'NETWORK'
        if (['CLAIM_UNAVAILABLE', 'ITEM_EXPIRED', 'NOT_FOUND', 'ALREADY_COLLECTED', 'CLAIM_HOLD_EXPIRED', 'STALE_CLAIM_VERSION', 'CAPABILITY_INVALID'].includes(code)) {
          removeClaim(listingId)
          await refresh()
        }
      }
    }
  }, [refresh])

  useEffect(() => {
    void recoverPendingClaims()
    const recover = () => void recoverPendingClaims()
    window.addEventListener('online', recover)
    window.addEventListener('focus', recover)
    return () => {
      window.removeEventListener('online', recover)
      window.removeEventListener('focus', recover)
    }
  }, [recoverPendingClaims])

  async function performClaim(item: ActiveBoardItem, crewLabel: string) {
    const run = async () => {
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
            setNotice('CHECKING CLAIM STATUS — the connection was interrupted. The exact attempt is saved and will be retried on reconnect/focus or from Activity.')
          }
        }
      } finally {
        setClaimingId(null)
      }
    }

    if ('locks' in navigator && navigator.locks) {
      await navigator.locks.request(`jettyshare:claim:${item.id}`, run)
    } else {
      await run()
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
    if (copyBusy) return
    setCopyBusy(true)
    setLastKnownOffer(null)
    try {
      let source = snapshot
      const stale = !lastSuccessAt || Date.now() - lastSuccessAt > 60000
      if (degraded || stale) {
        const fresh = await refresh()
        if (fresh) source = fresh
        else if (source && lastSuccessAt) {
          setLastKnownOffer(buildLastKnownSummary(source, window.location.origin, lastSuccessAt, clockNowMs))
          setNotice('Current availability could not be refreshed. Last-known text is available only as an explicitly labelled fallback.')
          return
        }
      }

      if (!source) {
        setNotice('Could not load the live board, so no supply summary was copied.')
        return
      }

      const active = activeSummaryItems(source, clockNowMs)
      if (!active.length) {
        setNotice('No supplies are currently available to copy.')
        return
      }

      const text = buildShareSummary(source, window.location.origin, clockNowMs)
      try {
        await navigator.clipboard.writeText(text)
        setNotice(`${active.length} available ${active.length === 1 ? 'supply' : 'supplies'} copied.`)
      } catch {
        setCopyFallback({ text, lastKnown: false })
      }
    } finally {
      setCopyBusy(false)
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

    {degraded && <div className="banner warning">UPDATES MAY BE DELAYED — the last good board stays visible while JettyShare reconciles automatically.</div>}
    {notice && <div className="banner" role="status">{notice}<button onClick={()=>setNotice('')} aria-label="Dismiss">×</button></div>}
    {lastKnownOffer && <div className="banner warning" role="status"><span>Refresh failed. Last-known text is not current.</span><button className="inline-action" onClick={()=>{setCopyFallback({ text: lastKnownOffer, lastKnown: true }); setLastKnownOffer(null)}}>View last-known text</button></div>}

    <section className="board-tools">
      <div className="filters" role="group" aria-label="Filter supplies">
        {(['ALL', 'ICE', 'BAIT'] as Filter[]).map((value)=><button key={value} aria-pressed={filter === value} className={filter === value ? 'selected' : ''} onClick={()=>setFilter(value)}>{value === 'ALL' ? 'All' : value === 'ICE' ? 'Ice' : 'Bait'}</button>)}
      </div>
      <button className="copy-button" disabled={copyBusy || !snapshot || liveItems.length === 0} onClick={()=>void copySummary()}>{copyBusy ? 'Checking availability…' : 'Copy all available'}</button>
    </section>

    <div className="section-heading">
      <div><p className="eyebrow">AVAILABLE NOW</p><h2>Urgent supply first</h2></div>
      <button className="link-button" onClick={()=>void refresh()}>Refresh</button>
    </div>

    {initialError && !snapshot
      ? <div className="empty" role="alert"><strong>Could not load the live board.</strong><span>Check the connection and retry. No inventory is being assumed.</span><button className="button" onClick={()=>void refresh()}>Retry</button></div>
      : loading && !snapshot
        ? <div className="empty">Loading available supplies…</div>
        : items.length === 0
          ? <div className="empty"><strong>{liveItems.length ? 'No supplies match this filter.' : 'No supplies available right now.'}</strong><span>Returning crews can post surplus ice or bait in seconds.</span></div>
          : <ul className="supply-list">{items.map((item)=><li key={item.id}><SupplyCard item={item} own={ownedIds.has(item.id)} pending={claimingId === item.id} nowMs={clockNowMs} onClaim={()=>requireIdentity({ type: 'claim', item })} /></li>)}</ul>}

    <button className="floating-post" onClick={()=>requireIdentity({ type: 'post' })}>+ POST SUPPLY</button>

    {identityAction && <IdentitySheet submitLabel={identityAction.type === 'claim' ? 'Save & Claim' : 'Save & Post'} onClose={()=>setIdentityAction(null)} onSaved={identitySaved} />}
    {postLabel && <PostSheet crewLabel={postLabel} onClose={()=>setPostLabel(null)} onPosted={refresh} />}
    {receipt && <ClaimReceiptSheet receipt={receipt.receipt} item={receipt.item} onClose={()=>setReceipt(null)} onRelease={releaseReceiptClaim} onHoldEnded={async()=>{await refresh(); setReceipt(null); setNotice('Reservation hold ended. The latest board state has been checked.')}} />}
    {activityOpen && <MyActivitySheet onClose={()=>setActivityOpen(false)} onChanged={refresh} />}
    {copyFallback && <CopyFallbackSheet text={copyFallback.text} lastKnown={copyFallback.lastKnown} onClose={()=>setCopyFallback(null)} />}
  </main>
}
