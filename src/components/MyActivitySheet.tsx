'use client'

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  claimListing,
  confirmCollected,
  createListing,
  getClaimReceipt,
  getOwnedListing,
  ownerReleaseClaim,
  releaseClaim,
  verifyPickupCode,
  JettyError,
} from '@/lib/api'
import { validateCrewLabel } from '@/lib/identity'
import {
  getClaims,
  getOwnedListings,
  getProfile,
  removeClaim,
  removeOwnedListing,
  saveProfile,
  setClaim,
  setOwnedListing,
} from '@/lib/storage'
import { adjustedNow, boardCountdown, serverClockOffset } from '@/lib/time'
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

function absoluteTime(value?: string) {
  if (!value) return '—'
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function Deadline({ label, value, nowMs }: { label: string; value?: string; nowMs: number }) {
  if (!value) return null
  const countdown = boardCountdown(value, nowMs)
  return <div className="deadline-row"><span>{label}</span><strong>{countdown.text}</strong></div>
}

export function MyActivitySheet({ onClose, onChanged }: { onClose: () => void; onChanged: () => Promise<unknown> | unknown }) {
  const [posts, setPosts] = useState<ManagedPost[]>([])
  const [claims, setClaims] = useState<ManagedClaim[]>([])
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState('')
  const [uncertainKeys, setUncertainKeys] = useState<Set<string>>(() => new Set())
  const [notice, setNotice] = useState('')
  const [clockOffsetMs, setClockOffsetMs] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileLabel, setProfileLabel] = useState(() => getProfile()?.crewLabel ?? '')
  const [profileDraft, setProfileDraft] = useState(() => getProfile()?.crewLabel ?? '')
  const [pickupInputs, setPickupInputs] = useState<Record<string, string>>({})
  const [verifiedPickupKeys, setVerifiedPickupKeys] = useState<Set<string>>(() => new Set())
  const lastPostData = useRef<Map<string, any>>(new Map())
  const lastClaimData = useRef<Map<string, any>>(new Map())

  const markUncertain = (key: string, uncertain: boolean) => {
    setUncertainKeys((current) => {
      const next = new Set(current)
      if (uncertain) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const reconcile = useCallback(async () => {
    setLoading(true)
    const owned = getOwnedListings()
    const claimMap = getClaims()
    const nextPosts: ManagedPost[] = []
    const nextClaims: ManagedClaim[] = []
    let newestServerNow: string | null = null

    for (const [id, entry] of Object.entries(owned)) {
      const key = `post:${id}`
      try {
        const data = await getOwnedListing(id, entry.ownerToken)
        if (data?.server_now) newestServerNow = data.server_now
        lastPostData.current.set(id, data)
        markUncertain(key, false)
        nextPosts.push({ id, ownerToken: entry.ownerToken, state: entry.state, createPayload: entry.createPayload, data })
        if (entry.state === 'pending-create') {
          setOwnedListing(id, { ownerToken: entry.ownerToken, state: 'managed', createdLocallyAt: entry.createdLocallyAt })
        }
        if (data?.effective_status === 'COLLECTED' || data?.effective_status === 'EXPIRED') {
          removeOwnedListing(id)
          lastPostData.current.delete(id)
        }
      } catch (error) {
        const code = error instanceof JettyError ? error.code : 'NETWORK'
        if (code === 'NETWORK') markUncertain(key, true)
        if (entry.state === 'pending-create' && code === 'NOT_FOUND' && entry.createPayload) {
          nextPosts.push({ id, ownerToken: entry.ownerToken, state: entry.state, createPayload: entry.createPayload, error: 'PENDING_CREATE' })
        } else {
          nextPosts.push({
            id,
            ownerToken: entry.ownerToken,
            state: entry.state,
            createPayload: entry.createPayload,
            data: code === 'NETWORK' ? lastPostData.current.get(id) : undefined,
            error: code,
          })
          if (entry.state === 'managed' && ['NOT_FOUND', 'CAPABILITY_INVALID'].includes(code)) {
            removeOwnedListing(id)
            lastPostData.current.delete(id)
          }
        }
      }
    }

    for (const [id, entry] of Object.entries(claimMap)) {
      const key = `claim:${id}`
      try {
        const data = await getClaimReceipt(id, entry.claimVersion, entry.claimToken)
        if (data?.server_now) newestServerNow = data.server_now
        lastClaimData.current.set(id, data)
        markUncertain(key, false)
        if (['COLLECTED', 'EXPIRED', 'ACTIVE'].includes(data?.effective_status)) {
          removeClaim(id)
          lastClaimData.current.delete(id)
          continue
        }
        nextClaims.push({ id, claimVersion: entry.claimVersion, claimToken: entry.claimToken, state: entry.state, claimantLabel: entry.claimantLabel, data })
        if (data?.effective_status === 'CLAIMED' && entry.state === 'pending-claim') {
          setClaim(id, {
            ...entry,
            state: 'held',
            claimExpiresAt: data.claim_expires_at,
            itemExpiresAt: data.expires_at,
          })
        }
      } catch (error) {
        const code = error instanceof JettyError ? error.code : 'NETWORK'
        if (code === 'NETWORK') markUncertain(key, true)
        const pendingRetry = entry.state === 'pending-claim' && code === 'STALE_CLAIM_VERSION'
        const endedClaim = !pendingRetry && ['STALE_CLAIM_VERSION', 'ITEM_EXPIRED', 'NOT_FOUND', 'ALREADY_COLLECTED', 'CLAIM_HOLD_EXPIRED', 'CAPABILITY_INVALID'].includes(code)
        if (endedClaim) {
          removeClaim(id)
          lastClaimData.current.delete(id)
          markUncertain(key, false)
          continue
        }
        nextClaims.push({
          id,
          claimVersion: entry.claimVersion,
          claimToken: entry.claimToken,
          state: entry.state,
          claimantLabel: entry.claimantLabel,
          data: code === 'NETWORK' ? lastClaimData.current.get(id) : undefined,
          error: pendingRetry ? 'PENDING_RETRY' : code,
        })
      }
    }

    if (newestServerNow) {
      const receivedAt = Date.now()
      const offset = serverClockOffset(newestServerNow, receivedAt)
      setClockOffsetMs(offset)
      setNowMs(adjustedNow(offset, receivedAt))
    }
    setPosts(nextPosts)
    setClaims(nextClaims)
    setLoading(false)
  }, [])

  useEffect(() => { void reconcile() }, [reconcile])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(adjustedNow(clockOffsetMs)), 1000)
    return () => window.clearInterval(timer)
  }, [clockOffsetMs])

  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') void reconcile() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('online', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('online', onFocus)
    }
  }, [reconcile])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reconcile()
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [reconcile])

  const nextBoundary = useMemo(() => {
    const times: number[] = []
    for (const post of posts) {
      if (post.data?.effective_status === 'CLAIMED') {
        if (post.data.claim_expires_at) times.push(new Date(post.data.claim_expires_at).getTime())
        if (post.data.expires_at) times.push(new Date(post.data.expires_at).getTime())
      }
    }
    for (const claim of claims) {
      if (claim.data?.effective_status === 'CLAIMED') {
        if (claim.data.claim_expires_at) times.push(new Date(claim.data.claim_expires_at).getTime())
        if (claim.data.expires_at) times.push(new Date(claim.data.expires_at).getTime())
      }
    }
    return times.filter((value) => value > nowMs).sort((a, b) => a - b)[0] ?? null
  }, [posts, claims, nowMs])

  useEffect(() => {
    if (!nextBoundary) return
    const timer = window.setTimeout(() => void reconcile(), Math.max(100, nextBoundary - nowMs + 250))
    return () => window.clearTimeout(timer)
  }, [nextBoundary, nowMs, reconcile])

  function saveCrewLabel(event: FormEvent) {
    event.preventDefault()
    try {
      const next = validateCrewLabel(profileDraft)
      saveProfile(next)
      setProfileLabel(next)
      setProfileDraft(next)
      setEditingProfile(false)
      setNotice('Boat / crew label updated for future posts and claims. Existing records keep their original label.')
    } catch {
      setNotice('Boat / crew name must be 1–40 visible characters.')
    }
  }

  async function retryPost(post: ManagedPost) {
    if (!post.createPayload) return
    const key = `post:${post.id}`
    setBusyKey(key)
    setNotice('')
    try {
      await createListing(post.createPayload, post.id, post.ownerToken)
      setOwnedListing(post.id, { ownerToken: post.ownerToken, state: 'managed', createdLocallyAt: new Date().toISOString() })
      markUncertain(key, false)
      setNotice('Pending post recovered successfully.')
      await onChanged()
    } catch (error) {
      if (error instanceof JettyError && ['INVALID_INPUT', 'CONFLICT'].includes(error.code)) {
        removeOwnedListing(post.id)
        setNotice('That saved post can no longer be retried safely.')
      } else {
        markUncertain(key, true)
        setNotice('CHECKING STATUS — the retry is still uncertain. The exact saved attempt has been kept.')
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
    const key = `claim:${claim.id}`
    setBusyKey(key)
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
      markUncertain(key, false)
      setNotice('Claim recovered. Pickup directions are shown below.')
      await onChanged()
    } catch (error) {
      if (error instanceof JettyError && ['CLAIM_UNAVAILABLE', 'ITEM_EXPIRED', 'NOT_FOUND', 'ALREADY_COLLECTED', 'CLAIM_HOLD_EXPIRED'].includes(error.code)) {
        removeClaim(claim.id)
        setNotice('That saved claim attempt can no longer win the supply. The board was refreshed.')
        await onChanged()
      } else {
        markUncertain(key, true)
        setNotice('CHECKING STATUS — the exact claim attempt remains saved.')
      }
    } finally {
      setBusyKey('')
      await reconcile()
    }
  }

  async function releaseOwn(claim: ManagedClaim) {
    if (!window.confirm('Release this claim? The supply will become available to other boats.')) return
    const key = `claim:${claim.id}`
    setBusyKey(key)
    setNotice('')
    try {
      await releaseClaim(claim.id, claim.claimVersion, claim.claimToken)
      removeClaim(claim.id)
      lastClaimData.current.delete(claim.id)
      markUncertain(key, false)
      setNotice('Claim released — supply is available again if it is still fresh.')
      await onChanged()
    } catch (error) {
      if (error instanceof JettyError && ['STALE_CLAIM_VERSION', 'CLAIM_HOLD_EXPIRED', 'ITEM_EXPIRED', 'ALREADY_COLLECTED', 'CLAIM_UNAVAILABLE'].includes(error.code)) {
        removeClaim(claim.id)
        lastClaimData.current.delete(claim.id)
        setNotice('That reservation had already ended.')
        await onChanged()
      } else {
        markUncertain(key, true)
        setNotice('CHECKING STATUS — connection interrupted. This claim stays saved until reconciliation proves the outcome.')
      }
    } finally {
      setBusyKey('')
      await reconcile()
    }
  }

  async function releaseAsOwner(post: ManagedPost) {
    const version = post.data?.claim_version
    if (!version) return
    if (!window.confirm(`Release ${post.data?.claimant_label || 'the current claimant'}? This supply will become available to other boats.`)) return
    const key = `post:${post.id}`
    setBusyKey(key)
    setNotice('')
    try {
      await ownerReleaseClaim(post.id, version, post.ownerToken)
      markUncertain(key, false)
      const verificationKey = `${post.id}:${version}`
      setVerifiedPickupKeys((current) => {
        const next = new Set(current)
        next.delete(verificationKey)
        return next
      })
      setPickupInputs((current) => {
        const next = { ...current }
        delete next[verificationKey]
        return next
      })
      setNotice('Claim released by provider.')
      await onChanged()
    } catch (error) {
      if (error instanceof JettyError && error.code !== 'NETWORK') {
        setNotice(`Could not release: ${error.code}. Checking the latest authoritative claim before enabling another action.`)
      } else {
        markUncertain(key, true)
        setNotice('CHECKING STATUS — the provider release result is uncertain. The owner capability is retained and destructive controls stay unavailable until reconciliation proves the current generation.')
      }
    } finally {
      setBusyKey('')
      await reconcile()
    }
  }

  function updatePickupInput(verificationKey: string, value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 4)
    setPickupInputs((current) => ({ ...current, [verificationKey]: digits }))
    setVerifiedPickupKeys((current) => {
      if (!current.has(verificationKey)) return current
      const next = new Set(current)
      next.delete(verificationKey)
      return next
    })
  }

  async function verifyPickup(post: ManagedPost) {
    const version = post.data?.claim_version
    if (!version) return
    const verificationKey = `${post.id}:${version}`
    const pickupCode = pickupInputs[verificationKey] ?? ''
    if (!/^[0-9]{4}$/.test(pickupCode)) {
      setNotice('Enter the claimant’s four-digit pickup code.')
      return
    }
    const key = `post:${post.id}`
    setBusyKey(`${key}:verify`)
    setNotice('')
    try {
      await verifyPickupCode(post.id, version, post.ownerToken, pickupCode)
      setVerifiedPickupKeys((current) => new Set(current).add(verificationKey))
      setNotice(`Collector verified — ${post.data?.claimant_label || 'the current claimant'} controls this reservation.`)
    } catch (error) {
      if (error instanceof JettyError && error.code === 'PICKUP_CODE_INVALID') {
        setNotice('Pickup code does not match the current reservation. Ask the claimant to check the code on their device.')
      } else if (error instanceof JettyError && error.code !== 'NETWORK') {
        setNotice(`Could not verify pickup: ${error.code}. Checking the latest authoritative state.`)
        await reconcile()
      } else {
        markUncertain(key, true)
        setNotice('CHECKING STATUS — pickup verification could not be confirmed because the connection is uncertain.')
      }
    } finally {
      setBusyKey('')
    }
  }

  async function collect(post: ManagedPost) {
    const version = post.data?.claim_version
    if (!version) return
    const verificationKey = `${post.id}:${version}`
    const pickupCode = pickupInputs[verificationKey] ?? ''
    if (!verifiedPickupKeys.has(verificationKey) || !/^[0-9]{4}$/.test(pickupCode)) {
      setNotice('Verify the claimant’s pickup code before confirming collection.')
      return
    }
    if (!window.confirm(`Confirm physical collection by ${post.data?.claimant_label || 'the current claimant'}? This marks the listing COLLECTED and cannot be undone.`)) return
    const key = `post:${post.id}`
    setBusyKey(key)
    setNotice('')
    try {
      await confirmCollected(post.id, version, post.ownerToken, pickupCode)
      removeOwnedListing(post.id)
      lastPostData.current.delete(post.id)
      markUncertain(key, false)
      setVerifiedPickupKeys((current) => {
        const next = new Set(current)
        next.delete(verificationKey)
        return next
      })
      setNotice('Collection confirmed.')
      await onChanged()
    } catch (error) {
      if (error instanceof JettyError && error.code === 'PICKUP_CODE_INVALID') {
        setVerifiedPickupKeys((current) => {
          const next = new Set(current)
          next.delete(verificationKey)
          return next
        })
        setNotice('Pickup verification is no longer valid for this reservation. Check the current claim and verify again.')
      } else if (error instanceof JettyError && error.code !== 'NETWORK') {
        setNotice(`Could not confirm: ${error.code}. Checking the latest authoritative state before enabling another action.`)
      } else {
        markUncertain(key, true)
        setNotice('CHECKING STATUS — the collection result is uncertain. The owner capability is retained and destructive controls stay unavailable until reconciliation proves whether collection committed.')
      }
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

      <section className="profile-panel" aria-label="Local boat or crew label">
        <div><span className="profile-label">Boat / crew</span><strong>{profileLabel || 'Not set'}</strong></div>
        {!editingProfile
          ? <button className="link-button" onClick={()=>setEditingProfile(true)}>Change</button>
          : <form className="profile-edit" onSubmit={saveCrewLabel}>
              <input aria-label="New boat / crew name" value={profileDraft} maxLength={40} onChange={(event)=>setProfileDraft(event.target.value)} />
              <button className="button compact" type="submit">Save</button>
              <button className="button compact" type="button" onClick={()=>{setProfileDraft(profileLabel);setEditingProfile(false)}}>Cancel</button>
            </form>}
      </section>

      {loading ? <div className="empty small">Checking latest status…</div> : <>
        <section className="activity-section">
          <h3>My Posts</h3>
          {posts.length === 0 ? <p className="muted">No manageable posts on this device.</p> : posts.map((post) => {
            const key = `post:${post.id}`
            const uncertain = uncertainKeys.has(key)
            const networkStale = post.error === 'NETWORK' && Boolean(post.data)
            const claimEndsAt = post.data?.claim_expires_at ? new Date(post.data.claim_expires_at).getTime() : null
            const holdEndingSoon = post.data?.effective_status === 'CLAIMED' && claimEndsAt && claimEndsAt > nowMs && claimEndsAt - nowMs <= 2 * 60_000
            const holdLive = post.data?.effective_status === 'CLAIMED' && claimEndsAt && claimEndsAt > nowMs
            const verificationKey = `${post.id}:${post.data?.claim_version ?? ''}`
            const pickupCode = pickupInputs[verificationKey] ?? ''
            const pickupVerified = verifiedPickupKeys.has(verificationKey)
            return <article className="managed-card" key={post.id}>
              {post.error === 'PENDING_CREATE' && post.createPayload ? <>
                <div className="managed-top"><strong>{post.createPayload.itemType} · {post.createPayload.quantityValue} {post.createPayload.quantityUnit}</strong><span className="status status-warning">UNCERTAIN</span></div>
                <p className="berth compact-berth">BERTH {post.createPayload.berth}</p>
                <p className="muted">The first request may not have reached the harbor board. Retry uses the exact same listing ID and owner capability.</p>
                <button className="button button-primary" disabled={busyKey === key || uncertain} onClick={()=>void retryPost(post)}>{busyKey === key ? 'Retrying…' : uncertain ? 'Checking status…' : 'Retry same post'}</button>
              </> : post.error && !networkStale ? <p>Could not load this post ({post.error}).</p> : <>
                <div className="managed-top"><strong>{post.data.item_type} · {Number(post.data.quantity_value)} {post.data.quantity_unit}</strong><span className={`status${networkStale ? ' status-warning' : ''}`}>{networkStale ? 'CHECKING' : post.data.effective_status}</span></div>
                <p className="berth compact-berth">BERTH {post.data.berth}</p>
                {post.data.effective_status === 'CLAIMED' && <>
                  <p>Claimed by <strong>{post.data.claimant_label}</strong></p>
                  {holdEndingSoon && <div className="banner warning compact-banner">HOLD ENDING SOON</div>}
                  <div className="deadline-grid">
                    <Deadline label="HOLD ENDS" value={post.data.claim_expires_at} nowMs={nowMs} />
                    <Deadline label="SPOILS" value={post.data.expires_at} nowMs={nowMs} />
                  </div>
                  <p className="confirm-before">Confirm before {absoluteTime(post.data.claim_expires_at)}</p>
                  {uncertain && <div className="banner warning compact-banner">CHECKING STATUS — management actions are disabled until the latest state is known.</div>}
                  <div className="stack" aria-label="Pickup verification">
                    <label>Pickup code
                      <input
                        aria-label={`Pickup code for berth ${post.data.berth}`}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={4}
                        value={pickupCode}
                        disabled={uncertain || !holdLive || busyKey === `${key}:verify`}
                        onChange={(event)=>updatePickupInput(verificationKey, event.target.value)}
                        placeholder="4 digits"
                      />
                    </label>
                    <button
                      className="button"
                      disabled={uncertain || !holdLive || pickupCode.length !== 4 || busyKey === `${key}:verify`}
                      onClick={()=>void verifyPickup(post)}
                    >{busyKey === `${key}:verify` ? 'Verifying…' : pickupVerified ? 'Verified ✓' : 'Verify pickup code'}</button>
                    {pickupVerified && <div className="banner compact-banner" role="status">Collector verified — safe to hand over this reservation.</div>}
                  </div>
                  <div className="action-grid">
                    <button className="button button-primary" disabled={busyKey === key || uncertain || !holdLive || !pickupVerified} onClick={()=>void collect(post)}>{holdLive ? 'Confirm collected' : 'Reservation ended'}</button>
                    <button className="button" disabled={busyKey === key || uncertain || !holdLive} onClick={()=>void releaseAsOwner(post)}>Release claim</button>
                  </div>
                </>}
                {post.data.effective_status === 'ACTIVE' && <p className="muted">Available on the public board.</p>}
                {post.data.effective_status === 'EXPIRED' && <p className="muted">Expired.</p>}
                {post.data.effective_status === 'COLLECTED' && <p className="muted">Collected.</p>}
              </>}
            </article>
          })}
        </section>

        <section className="activity-section">
          <h3>My Claims</h3>
          {claims.length === 0 ? <p className="muted">No current claims on this device.</p> : claims.map((claim) => {
            const key = `claim:${claim.id}`
            const uncertain = uncertainKeys.has(key)
            const networkStale = claim.error === 'NETWORK' && Boolean(claim.data)
            const claimEndsAt = claim.data?.claim_expires_at ? new Date(claim.data.claim_expires_at).getTime() : null
            const holdLive = claim.data?.effective_status === 'CLAIMED' && claimEndsAt && claimEndsAt > nowMs
            return <article className="managed-card" key={claim.id}>
              {claim.error === 'PENDING_RETRY' ? <>
                <div className="managed-top"><strong>Uncertain claim attempt</strong><span className="status status-warning">CHECKING</span></div>
                <p className="muted">The original request did not produce authoritative proof. Retry reuses the exact same claim version and capability.</p>
                <button className="button button-primary" disabled={busyKey === key || uncertain} onClick={()=>void retryClaim(claim)}>{busyKey === key ? 'Retrying…' : uncertain ? 'Checking status…' : 'Retry exact claim'}</button>
              </> : claim.error && !networkStale ? <p>Latest status: {claim.error}</p> : <>
                <div className="managed-top"><strong>{claim.data.item_type} · {Number(claim.data.quantity_value)} {claim.data.quantity_unit}</strong><span className={`status${networkStale ? ' status-warning' : ''}`}>{networkStale ? 'CHECKING' : claim.data.effective_status}</span></div>
                <p className="berth compact-berth">BERTH {claim.data.berth}</p>
                {claim.data.effective_status === 'CLAIMED' && claim.data.pickup_code && <div className="receipt-guidance" aria-label="Pickup verification code">
                  <p className="fact-label">PICKUP CODE</p>
                  <p className="quantity">{claim.data.pickup_code}</p>
                  <p className="muted">Show or tell this code to the supplying crew at pickup.</p>
                </div>}
                {claim.data.effective_status === 'CLAIMED' && <div className="deadline-grid">
                  <Deadline label="HOLD ENDS" value={claim.data.claim_expires_at} nowMs={nowMs} />
                  <Deadline label="SPOILS" value={claim.data.expires_at} nowMs={nowMs} />
                </div>}
                {uncertain && <div className="banner warning compact-banner">CHECKING STATUS — release is disabled until the latest state is known.</div>}
                {holdLive
                  ? <button className="button" disabled={busyKey === key || uncertain} onClick={()=>void releaseOwn(claim)}>{busyKey === key ? 'Releasing…' : 'I can’t make it — release'}</button>
                  : <p className="muted">Reservation ended.</p>}
              </>}
            </article>
          })}
        </section>
      </>}
    </div>
  </div>
}