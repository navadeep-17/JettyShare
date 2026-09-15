'use client'

import { useEffect, useState } from 'react'
import {
  claimListing,
  confirmCollected,
  createListing,
  getClaimReceipt,
  getOwnedListing,
  ownerReleaseClaim,
  releaseClaim,
  JettyError,
} from '@/lib/api'
import {
  getClaims,
  getOwnedListings,
  getProfile,
  removeClaim,
  removeOwnedListing,
  setClaim,
  setOwnedListing,
} from '@/lib/storage'
import type { ClaimLocalV1, CreateListingInput, OwnedListingLocalV1 } from '@/lib/types'

type ManagedPost = {
  id: string
  ownerToken: string
  state: OwnedListingLocalV1['state']
  createPayload?: CreateListingInput
  data?: any
  error?: string
}

type ManagedClaim = {
  id: string
  claimVersion: string
  claimToken: string
  state: ClaimLocalV1['state']
  claimantLabel?: string
  data?: any
  error?: string
}

export function MyActivitySheet({ onClose, onChanged }: { onClose: () => void; onChanged: () => Promise<unknown> | unknown }) {
  const [posts, setPosts] = useState<ManagedPost[]>([])
  const [claims, setClaims] = useState<ManagedClaim[]>([])
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState('')
  const [notice, setNotice] = useState('')

  async function reconcile() {
    setLoading(true)
    const owned = getOwnedListings()
    const claimMap = getClaims()
    const nextPosts: ManagedPost[] = []
    const nextClaims: ManagedClaim[] = []

    for (const [id, entry] of Object.entries(owned)) {
      try {
        const data = await getOwnedListing(id, entry.ownerToken)
        nextPosts.push({ id, ownerToken: entry.ownerToken, state: entry.state, createPayload: entry.createPayload, data })
        if (entry.state === 'pending-create') {
          setOwnedListing(id, { ownerToken: entry.ownerToken, state: 'managed', createdLocallyAt: entry.createdLocallyAt })
        }
        if (data?.effective_status === 'COLLECTED' || data?.effective_status === 'EXPIRED') removeOwnedListing(id)
      } catch (error) {
        const code = error instanceof JettyError ? error.code : 'NETWORK'
        if (entry.state === 'pending-create' && code === 'NOT_FOUND' && entry.createPayload) {
          nextPosts.push({ id, ownerToken: entry.ownerToken, state: entry.state, createPayload: entry.createPayload, error: 'PENDING_CREATE' })
        } else {
          nextPosts.push({ id, ownerToken: entry.ownerToken, state: entry.state, createPayload: entry.createPayload, error: code })
          if (entry.state === 'managed' && ['NOT_FOUND', 'CAPABILITY_INVALID'].includes(code)) removeOwnedListing(id)
        }
      }
    }

    for (const [id, entry] of Object.entries(claimMap)) {
      try {
        const data = await getClaimReceipt(id, entry.claimVersion, entry.claimToken)
        nextClaims.push({ id, claimVersion: entry.claimVersion, claimToken: entry.claimToken, state: entry.state, claimantLabel: entry.claimantLabel, data })
        if (data?.effective_status === 'CLAIMED' && entry.state === 'pending-claim') {
          setClaim(id, {
            ...entry,
            state: 'held',
            claimExpiresAt: data.claim_expires_at,
            itemExpiresAt: data.expires_at,
          })
        }
        if (['COLLECTED', 'EXPIRED', 'ACTIVE'].includes(data?.effective_status)) removeClaim(id)
      } catch (error) {
        const code = error instanceof JettyError ? error.code : 'NETWORK'
        const pendingRetry = entry.state === 'pending-claim' && code === 'STALE_CLAIM_VERSION'
        nextClaims.push({
          id,
          claimVersion: entry.claimVersion,
          claimToken: entry.claimToken,
          state: entry.state,
          claimantLabel: entry.claimantLabel,
          error: pendingRetry ? 'PENDING_RETRY' : code,
        })
        if (!pendingRetry && ['STALE_CLAIM_VERSION', 'ITEM_EXPIRED', 'NOT_FOUND', 'ALREADY_COLLECTED', 'CLAIM_HOLD_EXPIRED', 'CAPABILITY_INVALID'].includes(code)) {
          removeClaim(id)
        }
      }
    }

    setPosts(nextPosts)
    setClaims(nextClaims)
    setLoading(false)
  }

  useEffect(() => { void reconcile() }, [])

  async function retryPost(post: ManagedPost) {
    if (!post.createPayload) return
    setBusyKey(`post:${post.id}`)
    setNotice('')
    try {
      await createListing(post.createPayload, post.id, post.ownerToken)
      setOwnedListing(post.id, { ownerToken: post.ownerToken, state: 'managed', createdLocallyAt: new Date().toISOString() })
      setNotice('Pending post recovered successfully.')
      await onChanged()
    } catch (error) {
      if (error instanceof JettyError && ['INVALID_INPUT', 'CONFLICT'].includes(error.code)) {
        removeOwnedListing(post.id)
        setNotice('That saved post can no longer be retried safely.')
      } else {
        setNotice('The retry is still uncertain. The same saved attempt has been kept.')
      }
    } finally {
      setBusyKey('')
      await reconcile()
    }
  }

  async function retryClaim(claim: ManagedClaim) {
    const label = claim.claimantLabel || getProfile()?.crewLabel
    if (!label) {
      setNotice('A boat / crew label is required before this saved claim can be retried.')
      return
    }
    setBusyKey(`claim:${claim.id}`)
    setNotice('')
    try {
      const data = await claimListing(claim.id, label, claim.claimVersion, claim.claimToken)
      setClaim(claim.id, {
        claimVersion: claim.claimVersion,
        claimToken: claim.claimToken,
        claimantLabel: label,
        state: 'held',
        requestedLocallyAt: new Date().toISOString(),
        claimExpiresAt: data.claim_expires_at,
        itemExpiresAt: data.expires_at,
      })
      setNotice('Claim recovered. Pickup directions are shown below.')
      await onChanged()
    } catch (error) {
      if (error instanceof JettyError && ['CLAIM_UNAVAILABLE', 'ITEM_EXPIRED', 'NOT_FOUND', 'ALREADY_COLLECTED', 'CLAIM_HOLD_EXPIRED'].includes(error.code)) {
        removeClaim(claim.id)
        setNotice('That saved claim attempt can no longer win the supply. The board was refreshed.')
        await onChanged()
      } else {
        setNotice('The retry is still uncertain. The exact claim attempt remains saved.')
      }
    } finally {
      setBusyKey('')
      await reconcile()
    }
  }

  async function releaseOwn(claim: ManagedClaim) {
    setBusyKey(`claim:${claim.id}`)
    setNotice('')
    try {
      await releaseClaim(claim.id, claim.claimVersion, claim.claimToken)
      removeClaim(claim.id)
      setNotice('Claim released. Supply can return to the board if still fresh.')
      await onChanged()
    } catch (error) {
      if (error instanceof JettyError && ['STALE_CLAIM_VERSION', 'CLAIM_HOLD_EXPIRED', 'ITEM_EXPIRED', 'ALREADY_COLLECTED', 'CLAIM_UNAVAILABLE'].includes(error.code)) {
        removeClaim(claim.id)
        setNotice('That reservation had already ended.')
        await onChanged()
      } else {
        setNotice('Connection interrupted. The claim remains saved until its status can be reconciled.')
      }
    } finally {
      setBusyKey('')
      await reconcile()
    }
  }

  async function releaseAsOwner(post: ManagedPost) {
    const version = post.data?.claim_version
    if (!version) return
    setBusyKey(`post:${post.id}`)
    try {
      await ownerReleaseClaim(post.id, version, post.ownerToken)
      setNotice('Claim released by provider.')
      await onChanged()
    } catch (error) {
      setNotice(error instanceof JettyError ? `Could not release: ${error.code}` : 'Connection interrupted. Latest state will be checked.')
    } finally {
      setBusyKey('')
      await reconcile()
    }
  }

  async function collect(post: ManagedPost) {
    const version = post.data?.claim_version
    if (!version) return
    setBusyKey(`post:${post.id}`)
    try {
      await confirmCollected(post.id, version, post.ownerToken)
      removeOwnedListing(post.id)
      setNotice('Collection confirmed.')
      await onChanged()
    } catch (error) {
      setNotice(error instanceof JettyError ? `Could not confirm: ${error.code}` : 'Connection interrupted. Latest state will be checked.')
    } finally {
      setBusyKey('')
      await reconcile()
    }
  }

  return <div className="overlay" role="presentation">
    <div className="sheet activity-sheet" role="dialog" aria-modal="true" aria-labelledby="activity-title">
      <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
      <p className="eyebrow">DEVICE ACTIVITY</p>
      <h2 id="activity-title">My Activity</h2>
      <p className="muted">Posts and claims controlled by this browser.</p>
      {notice && <div className="banner" role="status">{notice}</div>}

      {loading ? <div className="empty small">Checking latest status…</div> : <>
        <section className="activity-section">
          <h3>My Posts</h3>
          {posts.length === 0 ? <p className="muted">No manageable posts on this device.</p> : posts.map((post) => <article className="managed-card" key={post.id}>
            {post.error === 'PENDING_CREATE' && post.createPayload ? <>
              <div className="managed-top"><strong>{post.createPayload.itemType} · {post.createPayload.quantityValue} {post.createPayload.quantityUnit}</strong><span className="status status-warning">UNCERTAIN</span></div>
              <p className="berth compact-berth">BERTH {post.createPayload.berth}</p>
              <p className="muted">The first request may not have reached the harbor board. Retry uses the exact same listing ID and owner capability.</p>
              <button className="button button-primary" disabled={busyKey === `post:${post.id}`} onClick={()=>void retryPost(post)}>{busyKey === `post:${post.id}` ? 'Retrying…' : 'Retry same post'}</button>
            </> : post.error ? <p>Could not load this post ({post.error}).</p> : <>
              <div className="managed-top"><strong>{post.data.item_type} · {Number(post.data.quantity_value)} {post.data.quantity_unit}</strong><span className="status">{post.data.effective_status}</span></div>
              <p className="berth compact-berth">BERTH {post.data.berth}</p>
              {post.data.effective_status === 'CLAIMED' && <>
                <p>Claimed by <strong>{post.data.claimant_label}</strong></p>
                <div className="action-grid">
                  <button className="button button-primary" disabled={busyKey === `post:${post.id}`} onClick={()=>void collect(post)}>Confirm collected</button>
                  <button className="button" disabled={busyKey === `post:${post.id}`} onClick={()=>void releaseAsOwner(post)}>Release claim</button>
                </div>
              </>}
              {post.data.effective_status === 'ACTIVE' && <p className="muted">Available on the public board.</p>}
              {post.data.effective_status === 'EXPIRED' && <p className="muted">Expired.</p>}
              {post.data.effective_status === 'COLLECTED' && <p className="muted">Collected.</p>}
            </>}
          </article>)}
        </section>

        <section className="activity-section">
          <h3>My Claims</h3>
          {claims.length === 0 ? <p className="muted">No current claims on this device.</p> : claims.map((claim) => <article className="managed-card" key={claim.id}>
            {claim.error === 'PENDING_RETRY' ? <>
              <div className="managed-top"><strong>Uncertain claim attempt</strong><span className="status status-warning">CHECKING</span></div>
              <p className="muted">The original request did not produce authoritative proof. Retry reuses the exact same claim version and capability.</p>
              <button className="button button-primary" disabled={busyKey === `claim:${claim.id}`} onClick={()=>void retryClaim(claim)}>{busyKey === `claim:${claim.id}` ? 'Retrying…' : 'Retry exact claim'}</button>
            </> : claim.error ? <p>Latest status: {claim.error}</p> : <>
              <div className="managed-top"><strong>{claim.data.item_type} · {Number(claim.data.quantity_value)} {claim.data.quantity_unit}</strong><span className="status">{claim.data.effective_status}</span></div>
              <p className="berth compact-berth">BERTH {claim.data.berth}</p>
              {claim.data.effective_status === 'CLAIMED'
                ? <button className="button" disabled={busyKey === `claim:${claim.id}`} onClick={()=>void releaseOwn(claim)}>{busyKey === `claim:${claim.id}` ? 'Releasing…' : 'I can’t make it — release'}</button>
                : <p className="muted">Reservation ended.</p>}
            </>}
          </article>)}
        </section>
      </>}
    </div>
  </div>
}
