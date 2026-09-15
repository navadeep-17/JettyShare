'use client'

import { useEffect, useState } from 'react'
import { confirmCollected, getClaimReceipt, getOwnedListing, ownerReleaseClaim, releaseClaim, JettyError } from '@/lib/api'
import { getClaims, getOwnedListings, removeClaim, removeOwnedListing } from '@/lib/storage'

type ManagedPost = { id: string; ownerToken: string; data?: any; error?: string }
type ManagedClaim = { id: string; claimVersion: string; claimToken: string; data?: any; error?: string }

export function MyActivitySheet({ onClose, onChanged }: { onClose: () => void; onChanged: () => Promise<void> | void }) {
  const [posts, setPosts] = useState<ManagedPost[]>([])
  const [claims, setClaims] = useState<ManagedClaim[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')

  async function reconcile() {
    setLoading(true); setNotice('')
    const owned = getOwnedListings()
    const claimMap = getClaims()
    const nextPosts: ManagedPost[] = []
    const nextClaims: ManagedClaim[] = []

    for (const [id, entry] of Object.entries(owned)) {
      try {
        const data = await getOwnedListing(id, entry.ownerToken)
        nextPosts.push({ id, ownerToken: entry.ownerToken, data })
        if (data?.effective_status === 'COLLECTED' || data?.effective_status === 'EXPIRED') removeOwnedListing(id)
      } catch (e) {
        nextPosts.push({ id, ownerToken: entry.ownerToken, error: e instanceof JettyError ? e.code : 'NETWORK' })
      }
    }

    for (const [id, entry] of Object.entries(claimMap)) {
      try {
        const data = await getClaimReceipt(id, entry.claimVersion, entry.claimToken)
        nextClaims.push({ id, claimVersion: entry.claimVersion, claimToken: entry.claimToken, data })
        if (['COLLECTED','EXPIRED','ACTIVE'].includes(data?.effective_status)) removeClaim(id)
      } catch (e) {
        const code = e instanceof JettyError ? e.code : 'NETWORK'
        nextClaims.push({ id, claimVersion: entry.claimVersion, claimToken: entry.claimToken, error: code })
        if (['STALE_CLAIM_VERSION','ITEM_EXPIRED','NOT_FOUND','ALREADY_COLLECTED'].includes(code)) removeClaim(id)
      }
    }

    setPosts(nextPosts); setClaims(nextClaims); setLoading(false)
  }

  useEffect(() => { void reconcile() }, [])

  async function releaseOwn(c: ManagedClaim) {
    setNotice('')
    try {
      await releaseClaim(c.id, c.claimVersion, c.claimToken)
      removeClaim(c.id); setNotice('Claim released. Supply can return to the board if still fresh.')
      await onChanged(); await reconcile()
    } catch (e) {
      setNotice(e instanceof JettyError ? `Could not release: ${e.code}` : 'Connection interrupted. Checking latest status is safest.')
      await reconcile()
    }
  }

  async function releaseAsOwner(p: ManagedPost) {
    const version = p.data?.claim_version
    if (!version) return
    try {
      await ownerReleaseClaim(p.id, version, p.ownerToken)
      setNotice('Claim released by provider.'); await onChanged(); await reconcile()
    } catch (e) {
      setNotice(e instanceof JettyError ? `Could not release: ${e.code}` : 'Connection interrupted.'); await reconcile()
    }
  }

  async function collect(p: ManagedPost) {
    const version = p.data?.claim_version
    if (!version) return
    try {
      await confirmCollected(p.id, version, p.ownerToken)
      removeOwnedListing(p.id); setNotice('Collection confirmed.'); await onChanged(); await reconcile()
    } catch (e) {
      setNotice(e instanceof JettyError ? `Could not confirm: ${e.code}` : 'Connection interrupted.'); await reconcile()
    }
  }

  return <div className="overlay"><div className="sheet activity-sheet" role="dialog" aria-modal="true" aria-labelledby="activity-title">
    <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
    <p className="eyebrow">DEVICE ACTIVITY</p><h2 id="activity-title">My Activity</h2>
    <p className="muted">Posts and claims controlled by this browser.</p>
    {notice && <div className="banner">{notice}</div>}
    {loading ? <div className="empty small">Checking latest status…</div> : <>
      <section className="activity-section"><h3>My Posts</h3>{posts.length === 0 ? <p className="muted">No manageable posts on this device.</p> : posts.map(p => <article className="managed-card" key={p.id}>{p.error ? <p>Could not load this post ({p.error}).</p> : <>
        <div className="managed-top"><strong>{p.data.item_type} · {Number(p.data.quantity_value)} {p.data.quantity_unit}</strong><span className="status">{p.data.effective_status}</span></div>
        <p className="berth compact-berth">BERTH {p.data.berth}</p>
        {p.data.effective_status === 'CLAIMED' && <><p>Claimed by <strong>{p.data.claimant_label}</strong></p><div className="action-grid"><button className="button button-primary" onClick={()=>void collect(p)}>Confirm collected</button><button className="button" onClick={()=>void releaseAsOwner(p)}>Release claim</button></div></>}
        {p.data.effective_status === 'ACTIVE' && <p className="muted">Available on the public board.</p>}
        {p.data.effective_status === 'EXPIRED' && <p className="muted">Expired.</p>}
        {p.data.effective_status === 'COLLECTED' && <p className="muted">Collected.</p>}
      </>}</article>)}</section>
      <section className="activity-section"><h3>My Claims</h3>{claims.length === 0 ? <p className="muted">No current claims on this device.</p> : claims.map(c => <article className="managed-card" key={c.id}>{c.error ? <p>Latest status: {c.error}</p> : <>
        <div className="managed-top"><strong>{c.data.item_type} · {Number(c.data.quantity_value)} {c.data.quantity_unit}</strong><span className="status">{c.data.effective_status}</span></div>
        <p className="berth compact-berth">BERTH {c.data.berth}</p>
        {c.data.effective_status === 'CLAIMED' ? <button className="button" onClick={()=>void releaseOwn(c)}>I can’t make it — release</button> : <p className="muted">Reservation ended.</p>}
      </>}</article>)}</section>
    </>}
  </div></div>
}
