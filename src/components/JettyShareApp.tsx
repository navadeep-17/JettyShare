'use client'

import { useMemo, useState } from 'react'
import { claimListing, JettyError } from '@/lib/api'
import { newClaimVersion, randomCapability } from '@/lib/capabilities'
import { getOwnedListings, getProfile, removeClaim, setClaim, storageAvailable } from '@/lib/storage'
import type { ActiveBoardItem, ClaimReceipt } from '@/lib/types'
import { useLiveBoard } from '@/hooks/useLiveBoard'
import { IdentitySheet } from './IdentitySheet'
import { PostSheet } from './PostSheet'
import { SupplyCard } from './SupplyCard'
import { ClaimReceiptSheet } from './ClaimReceiptSheet'
import { MyActivitySheet } from './MyActivitySheet'
import { formatRemaining } from './Countdown'

type Filter = 'ALL' | 'ICE' | 'BAIT'
type PendingAction = { type: 'post' } | { type: 'claim'; item: ActiveBoardItem }

export function JettyShareApp() {
  const { snapshot, loading, degraded, refresh } = useLiveBoard()
  const [filter, setFilter] = useState<Filter>('ALL')
  const [identityAction, setIdentityAction] = useState<PendingAction | null>(null)
  const [postLabel, setPostLabel] = useState<string | null>(null)
  const [claimingId, setClaimingId] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<{ receipt: ClaimReceipt; item: ActiveBoardItem } | null>(null)
  const [activityOpen, setActivityOpen] = useState(false)
  const [notice, setNotice] = useState('')

  const items = useMemo(() => (snapshot?.items ?? []).filter(x => filter === 'ALL' || x.item_type === filter), [snapshot, filter])
  const ownedIds = useMemo(() => typeof window === 'undefined' ? new Set<string>() : new Set(Object.keys(getOwnedListings())), [snapshot])

  function requireIdentity(action: PendingAction) {
    const profile = getProfile()
    if (profile?.crewLabel) {
      if (action.type === 'post') setPostLabel(profile.crewLabel)
      else void performClaim(action.item, profile.crewLabel)
    } else setIdentityAction(action)
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
    const claimVersion = newClaimVersion()
    const claimToken = randomCapability()
    setClaim(item.id, { claimVersion, claimToken, state: 'pending-claim', requestedLocallyAt: new Date().toISOString() })
    setClaimingId(item.id)
    setNotice('')
    try {
      const result = await claimListing(item.id, crewLabel, claimVersion, claimToken)
      setClaim(item.id, {
        claimVersion,
        claimToken,
        state: 'held',
        requestedLocallyAt: new Date().toISOString(),
        claimExpiresAt: result.claim_expires_at,
        itemExpiresAt: result.expires_at,
      })
      setReceipt({ receipt: result, item })
      await refresh()
    } catch (error) {
      if (error instanceof JettyError && ['CLAIM_UNAVAILABLE','ITEM_EXPIRED','NOT_FOUND'].includes(error.code)) {
        removeClaim(item.id)
        setNotice(error.code === 'ITEM_EXPIRED' ? 'This supply just expired.' : 'Someone else just claimed this supply.')
        await refresh()
      } else {
        setNotice('Claim status is uncertain because the connection was interrupted. The attempt has been kept safely for recovery in My Activity.')
      }
    } finally {
      setClaimingId(null)
    }
  }

  async function copySummary() {
    if (!snapshot) return
    const live = snapshot.items.filter(x => new Date(x.expires_at).getTime() > Date.now())
    const lines = live.map((x, i) => {
      const urgent = new Date(x.expires_at).getTime() - Date.now() <= 15 * 60 * 1000 ? 'URGENT | ' : ''
      const unit = x.quantity_unit === 'KG' ? 'kg' : x.quantity_unit.toLowerCase() + (Number(x.quantity_value) === 1 ? '' : 's')
      return `${i + 1}. ${urgent}${x.item_type} | ${Number(x.quantity_value)} ${unit} | Berth ${x.berth} | ${formatRemaining(new Date(x.expires_at).getTime() - Date.now())}`
    })
    const text = `JETTYSHARE - SUPPLIES AVAILABLE NOW\n\n${lines.length ? lines.join('\n') : 'No supplies currently available.'}\n\nLive board: ${location.origin}/\nAvailability changes quickly - check the live board before pickup.`
    try {
      await navigator.clipboard.writeText(text)
      setNotice('Available supplies copied.')
    } catch {
      setNotice('Clipboard access failed. Please use your browser copy controls.')
    }
  }

  return <main className="app-shell">
    <header className="topbar">
      <div><p className="eyebrow">COASTAL JETTY BOARD</p><h1>JettyShare</h1><p className="subtitle">Fresh surplus. Fast pickup. Less waste.</p></div>
      <div className="top-actions"><button className="button compact" onClick={()=>setActivityOpen(true)}>Activity</button><button className="button button-primary compact" onClick={()=>requireIdentity({type:'post'})}>+ Post</button></div>
    </header>
    {degraded && <div className="banner warning">Live updates paused — retrying.</div>}
    {notice && <div className="banner" role="status">{notice}<button onClick={()=>setNotice('')} aria-label="Dismiss">×</button></div>}
    <section className="board-tools"><div className="filters" role="group" aria-label="Filter supplies">{(['ALL','ICE','BAIT'] as Filter[]).map(x=><button key={x} className={filter===x?'selected':''} onClick={()=>setFilter(x)}>{x==='ALL'?'All':x==='ICE'?'Ice':'Bait'}</button>)}</div><button className="copy-button" onClick={copySummary}>Copy all available</button></section>
    <div className="section-heading"><div><p className="eyebrow">AVAILABLE NOW</p><h2>Urgent supply first</h2></div><button className="link-button" onClick={()=>void refresh()}>Refresh</button></div>
    {loading && !snapshot ? <div className="empty">Loading available supplies…</div> : items.length === 0 ? <div className="empty"><strong>{snapshot?.items.length ? 'No supplies match this filter.' : 'No supplies available right now.'}</strong><span>Returning crews can post surplus ice or bait in seconds.</span></div> : <div className="supply-list">{items.map(item=><SupplyCard key={item.id} item={item} own={ownedIds.has(item.id)} pending={claimingId===item.id} onClaim={()=>requireIdentity({type:'claim',item})} />)}</div>}
    <button className="floating-post" onClick={()=>requireIdentity({type:'post'})}>+ POST SUPPLY</button>
    {identityAction && <IdentitySheet onClose={()=>setIdentityAction(null)} onSaved={identitySaved} />}
    {postLabel && <PostSheet crewLabel={postLabel} onClose={()=>setPostLabel(null)} onPosted={refresh} />}
    {receipt && <ClaimReceiptSheet receipt={receipt.receipt} item={receipt.item} onClose={()=>setReceipt(null)} />}
    {activityOpen && <MyActivitySheet onClose={()=>setActivityOpen(false)} onChanged={refresh} />}
  </main>
}
