'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { claimListing, getClaimReceipt, JettyError } from '@/lib/api'
import { newClaimVersion, randomCapability } from '@/lib/capabilities'
import { getClaims, getOwnedListings, getProfile, removeClaim, setClaim, storageAvailable } from '@/lib/storage'
import { activeSummaryItems, buildLastKnownSummary, canonicalBoardUrl, formatActiveSupplySummary } from '@/lib/summary'
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
  const [receipt, setReceipt] = useState<ClaimReceipt | null>(null)
  const [activityOpen, setActivityOpen] = useState(false)
  const [copyFallback, setCopyFallback] = useState<{ text: string; lastKnown: boolean } | null>(null)
  const [lastKnownOffer, setLastKnownOffer] = useState<string | null>(null)
  const [copyBusy, setCopyBusy] = useState(false)
  const copyBusyRef = useRef(false)
  const [notice, setNotice] = useState('')
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine)

  const liveItems = useMemo(
    () => (snapshot?.items ?? []).filter((item) => new Date(item.expires_at).getTime() > clockNowMs),
    [snapshot, clockNowMs],
  )
  const items = useMemo(
    () => liveItems.filter((item) => filter === 'ALL' || item.item_type === filter),
    [liveItems, filter],
  )
  const ownedIds = typeof window === 'undefined' ? new Set<string>() : new Set(Object.keys(getOwnedListings()))

  useEffect(() => {
    const onlineHandler = () => setOnline(true)
    const offlineHandler = () => setOnline(false)
    window.addEventListener('online', onlineHandler)
    window.addEventListener('offline', offlineHandler)
    return () => {
      window.removeEventListener('online', onlineHandler)
      window.removeEventListener('offline', offlineHandler)
    }
  }, [])

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
        const current = await getClaimReceipt(listingId, saved.claimVersion, saved.claimToken)
        if (current.effective_status === 'CLAIMED') {
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
        if (['CLAIM_UNAVAILABLE', 'ITEM_EXPIRED', 'NOT_FOUND', 'ALREADY_COLLECTED', 'CLAIM_HOLD_EXPIRED', 'STALE_CLAIM_VERSION', 'CAPABILITY_INVALID', 'INVALID_INPUT'].includes(code)) {
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
    if (!navigator.onLine) {
      setNotice('Connection needed to claim. The board remains readable, but JettyShare will not guess an authoritative claim result while offline.')
      return
    }

    const run = async () => {
      if (!storageAvailable()) {
        setNotice('This browser can’t save the access key needed to manage a claim. Enable site storage or use normal browsing mode.')
        return
      }

      const existing = getClaims()[item.id]
      if (existing?.state === 'held') {
        setNotice('This device already holds that supply. Open Activity to manage the reservation.')
        return
      }

      if (!existing) {
        setClaim(item.id, {
          claimVersion: newClaimVersion(),
          claimToken: randomCapability(),
          claimantLabel: crewLabel,
          state: 'pending-claim',
          requestedLocallyAt: new Date().toISOString(),
        })
        // Web Locks is not universal. A short localStorage stabilization window makes
        // simultaneous same-origin tabs converge on one persisted pending generation
        // before either sends a network mutation.
        await sleep(60)
      }

      const savedAttempt = getClaims()[item.id]
      if (!savedAttempt) {
        setNotice('Could not persist this claim attempt safely. Refresh and try again.')
        return
      }
      if (savedAttempt.state === 'held') {
        setNotice('This device already holds that supply. Open Activity to manage the reservation.')
        return
      }

      const claimVersion = savedAttempt.claimVersion
      const claimToken = savedAttempt.claimToken
      const claimantLabel = savedAttempt.claimantLabel || crewLabel
      const requestedLocallyAt = savedAttempt.requestedLocallyAt
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
            setReceipt(result)
            await refresh()
            return
          } catch (error) {
            if (error instanceof JettyError && ['CLAIM_UNAVAILABLE', 'ITEM_EXPIRED', 'NOT_FOUND', 'ALREADY_COLLECTED'].includes(error.code)) {
              removeClaim(item.id)
              const copy = error.code === 'ITEM_EXPIRED'
                ? 'This supply has expired.'
                : error.code === 'NOT_FOUND'
                  ? 'This listing is no longer available.'
                  : error.code === 'ALREADY_COLLECTED'
                    ? 'This supply has already been collected.'
                    : 'Someone just claimed this supply.'
              setNotice(copy)
              await refresh()
              return
            }
            if (error instanceof JettyError && ['CLAIM_HOLD_EXPIRED', 'STALE_CLAIM_VERSION', 'CAPABILITY_INVALID'].includes(error.code)) {
              removeClaim(item.id)
              setNotice(error.code === 'CAPABILITY_INVALID'
                ? 'This saved claim could not be verified on this device.'
                : 'This saved claim attempt is no longer current. The board has been refreshed.')
              await refresh()
              return
            }
            if (error instanceof JettyError && error.code === 'INVALID_INPUT') {
              removeClaim(item.id)
              setNotice('Couldn’t start the claim. Refresh and try again.')
              await refresh()
              return
            }
            if (requestNumber < 2) {
              await sleep(backoff[requestNumber])
              continue
            }
            setNotice('Connection interrupted — checking claim status. The exact attempt is saved and will be retried on reconnect/focus or from Activity.')
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

  async function copySummary() {
    // State alone cannot close the same-tick double-tap window because two click
    // handlers may run before React commits the disabled state. This ref is the
    // synchronous attempt lock; state remains the visible pending indicator.
    if (copyBusyRef.current) return
    copyBusyRef.current = true
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

      const result = formatActiveSupplySummary({
        items: source.items,
        adjustedNowMs: clockNowMs,
        canonicalBoardUrl: canonicalBoardUrl(window.location.origin),
      })
      if (!result.includedCount) {
        setNotice('No supplies are currently available to copy.')
        return
      }

      try {
        await navigator.clipboard.writeText(result.text)
        setNotice(`${result.includedCount} available ${result.includedCount === 1 ? 'supply' : 'supplies'} copied.`)
      } catch {
        setCopyFallback({ text: result.text, lastKnown: false })
      }
    } finally {
      copyBusyRef.current = false
      setCopyBusy(false)
    }
  }

  async function retryCopyRefresh(fallbackText: string | null = lastKnownOffer) {
    if (copyBusyRef.current) return
    copyBusyRef.current = true
    setCopyBusy(true)
    setCopyFallback(null)
    setLastKnownOffer(null)
    try {
      const fresh = await refresh()
      if (fresh) {
        setNotice('Current availability refreshed. Copy all available when ready.')
        return
      }
      if (fallbackText) setLastKnownOffer(fallbackText)
      setNotice('Could not refresh availability. Try again, or inspect the explicitly labelled last-known text.')
    } finally {
      copyBusyRef.current = false
      setCopyBusy(false)
    }
  }

  function emptyState() {
    if (liveItems.length === 0) {
      return <div className="empty"><strong>No supplies available right now.</strong><span>Returning crews can post surplus ice or bait in seconds.</span><button className="button button-primary" onClick={()=>requireIdentity({ type: 'post' })}>Post supply</button></div>
    }
    const label = filter === 'ICE' ? 'ice' : 'bait'
    return <div className="empty"><strong>No {label} available right now.</strong><span>Other fresh supplies may still be available.</span><div className="empty-actions"><button className="button" onClick={()=>setFilter('ALL')}>Show all</button><button className="button button-primary" onClick={()=>requireIdentity({ type: 'post' })}>Post supply</button></div></div>
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

    {!online && <div className="banner warning">OFFLINE — last-loaded information may be stale. Connection is required for authoritative post, claim, release and collection actions.</div>}
    {degraded && <div className="banner warning">UPDATES MAY BE DELAYED — the last good board stays visible while JettyShare reconciles automatically.</div>}
    {notice && <div className="banner" role="status">{notice}<button onClick={()=>setNotice('')} aria-label="Dismiss">×</button></div>}
    {lastKnownOffer && <div className="banner warning copy-stale-banner" role="status">
      <span>Refresh failed. Last-known text is not current.</span>
      <div className="copy-stale-actions">
        <button className="inline-action" disabled={copyBusy} onClick={()=>void retryCopyRefresh(lastKnownOffer)}>Retry refresh</button>
        <button className="inline-action" disabled={copyBusy} onClick={()=>{setCopyFallback({ text: lastKnownOffer, lastKnown: true }); setLastKnownOffer(null)}}>View last-known text</button>
      </div>
    </div>}

    <section className="board-tools">
      <div className="filters" role="group" aria-label="Filter supplies">
        {(['ALL', 'ICE', 'BAIT'] as Filter[]).map((value)=><button key={value} aria-pressed={filter === value} className={filter === value ? 'selected' : ''} onClick={()=>setFilter(value)}>{value === 'ALL' ? 'All' : value === 'ICE' ? 'Ice' : 'Bait'}</button>)}
      </div>
      <button
        className="copy-button"
        aria-label="Copy all available supplies"
        aria-busy={copyBusy}
        disabled={copyBusy || !snapshot || liveItems.length === 0}
        onClick={()=>void copySummary()}
      >{copyBusy ? 'Checking availability…' : 'Copy all available'}</button>
    </section>

    <div className="section-heading">
      <div><p className="eyebrow">AVAILABLE NOW</p><h2 id="available-supplies">Urgent supply first</h2></div>
      <button className="link-button" onClick={()=>void refresh()}>Refresh</button>
    </div>

    {initialError && !snapshot
      ? <div className="empty" role="alert"><strong>Could not load supplies. Check connection.</strong><span>No inventory is being assumed.</span><button className="button" onClick={()=>void refresh()}>Retry</button></div>
      : loading && !snapshot
        ? <div className="empty">Loading available supplies…</div>
        : items.length === 0
          ? emptyState()
          : <ul className="supply-list" aria-labelledby="available-supplies">{items.map((item)=><li key={item.id}><SupplyCard item={item} own={ownedIds.has(item.id)} pending={claimingId === item.id} nowMs={clockNowMs} onClaim={()=>requireIdentity({ type: 'claim', item })} /></li>)}</ul>}

    <button className="floating-post" onClick={()=>requireIdentity({ type: 'post' })}>+ POST SUPPLY</button>

    {identityAction && <IdentitySheet submitLabel={identityAction.type === 'claim' ? 'Save & Claim' : 'Save & Post'} onClose={()=>setIdentityAction(null)} onSaved={identitySaved} />}
    {postLabel && <PostSheet crewLabel={postLabel} onClose={()=>setPostLabel(null)} onPosted={refresh} />}
    {receipt && <ClaimReceiptSheet receipt={receipt} onClose={()=>setReceipt(null)} onHoldEnded={async()=>{await refresh(); setReceipt(null); setNotice('Reservation hold ended. The latest board state has been checked.')}} />}
    {activityOpen && <MyActivitySheet onClose={()=>setActivityOpen(false)} onChanged={refresh} />}
    {copyFallback && <CopyFallbackSheet
      text={copyFallback.text}
      lastKnown={copyFallback.lastKnown}
      onRetryRefresh={copyFallback.lastKnown ? ()=>void retryCopyRefresh(copyFallback.text) : undefined}
      onClose={()=>setCopyFallback(null)}
    />}
  </main>
}
