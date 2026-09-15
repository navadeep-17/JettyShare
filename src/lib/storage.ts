import type { ClaimLocalV1, LocalProfileV1, OwnedListingLocalV1 } from './types'

const PROFILE_KEY = 'jettyshare:v1:profile'
const OWNED_KEY = 'jettyshare:v1:owned-listings'
const CLAIMS_KEY = 'jettyshare:v1:claims'

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

export function storageAvailable(): boolean {
  try {
    const key = 'jettyshare:storage-probe'
    localStorage.setItem(key, '1')
    const ok = localStorage.getItem(key) === '1'
    localStorage.removeItem(key)
    return ok
  } catch { return false }
}

export function getProfile(): LocalProfileV1 | null {
  return safeParse<LocalProfileV1 | null>(localStorage.getItem(PROFILE_KEY), null)
}

export function saveProfile(crewLabel: string): LocalProfileV1 {
  const profile = { crewLabel: crewLabel.trim(), updatedAt: new Date().toISOString() }
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  return profile
}

export function getOwnedListings(): Record<string, OwnedListingLocalV1> {
  return safeParse(localStorage.getItem(OWNED_KEY), {})
}

export function setOwnedListing(id: string, value: OwnedListingLocalV1): void {
  const all = getOwnedListings(); all[id] = value
  localStorage.setItem(OWNED_KEY, JSON.stringify(all))
}

export function removeOwnedListing(id: string): void {
  const all = getOwnedListings(); delete all[id]
  localStorage.setItem(OWNED_KEY, JSON.stringify(all))
}

export function getClaims(): Record<string, ClaimLocalV1> {
  return safeParse(localStorage.getItem(CLAIMS_KEY), {})
}

export function setClaim(id: string, value: ClaimLocalV1): void {
  const all = getClaims(); all[id] = value
  localStorage.setItem(CLAIMS_KEY, JSON.stringify(all))
}

export function removeClaim(id: string): void {
  const all = getClaims(); delete all[id]
  localStorage.setItem(CLAIMS_KEY, JSON.stringify(all))
}
