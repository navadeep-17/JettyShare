import { supabase } from './supabase'
import type { BoardSnapshot, ClaimReceipt, CreateListingInput, ManagedClaimReceipt } from './types'

export type JettyErrorCode =
  | 'INVALID_INPUT' | 'NOT_FOUND' | 'ITEM_EXPIRED' | 'CLAIM_UNAVAILABLE'
  | 'CLAIM_HOLD_EXPIRED' | 'STALE_CLAIM_VERSION' | 'CAPABILITY_INVALID'
  | 'PICKUP_CODE_INVALID' | 'ALREADY_COLLECTED' | 'LISTING_WITHDRAWN' | 'CONFLICT' | 'NETWORK'

export class JettyError extends Error {
  constructor(public code: JettyErrorCode, message?: string) { super(message ?? code) }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CAPABILITY_RE = /^[A-Za-z0-9_-]{43}$/
const PICKUP_CODE_RE = /^[0-9]{4}$/
const api = supabase.schema('api')

function requireClaimSecret(listingId: string, claimVersion: string, claimToken: string): void {
  if (!UUID_RE.test(listingId) || !UUID_RE.test(claimVersion) || !CAPABILITY_RE.test(claimToken)) {
    throw new JettyError('CAPABILITY_INVALID', 'Saved claim capability is malformed')
  }
}

function requirePickupCode(pickupCode: string): void {
  if (!PICKUP_CODE_RE.test(pickupCode)) {
    throw new JettyError('PICKUP_CODE_INVALID', 'Pickup code must be four digits')
  }
}

function mapRpcError(error: { message?: string } | null): never {
  const message = error?.message ?? ''
  const codes: JettyErrorCode[] = ['INVALID_INPUT','NOT_FOUND','ITEM_EXPIRED','CLAIM_UNAVAILABLE','CLAIM_HOLD_EXPIRED','STALE_CLAIM_VERSION','CAPABILITY_INVALID','PICKUP_CODE_INVALID','ALREADY_COLLECTED','LISTING_WITHDRAWN','CONFLICT']
  const code = codes.find((candidate) => message.includes(candidate))
  throw new JettyError(code ?? 'NETWORK', message)
}

export async function getBoardSnapshot(): Promise<BoardSnapshot> {
  const { data, error } = await api.rpc('get_board_snapshot')
  if (error) mapRpcError(error)
  return data as BoardSnapshot
}

export async function createListing(input: CreateListingInput, listingId: string, ownerToken: string) {
  const { data, error } = await api.rpc('create_listing', {
    p_listing_id: listingId,
    p_item_type: input.itemType,
    p_quantity_value: input.quantityValue,
    p_quantity_unit: input.quantityUnit,
    p_berth: input.berth,
    p_poster_label: input.posterLabel,
    p_spoil_minutes: input.spoilMinutes,
    p_owner_token: ownerToken,
  })
  if (error) mapRpcError(error)
  return data
}

export async function claimListing(listingId: string, claimantLabel: string, claimVersion: string, claimToken: string): Promise<ClaimReceipt> {
  requireClaimSecret(listingId, claimVersion, claimToken)
  const { data, error } = await api.rpc('claim_listing', {
    p_listing_id: listingId,
    p_claimant_label: claimantLabel,
    p_claim_version: claimVersion,
    p_claim_token: claimToken,
  })
  if (error) mapRpcError(error)
  return data as ClaimReceipt
}

export async function releaseClaim(listingId: string, claimVersion: string, claimToken: string) {
  requireClaimSecret(listingId, claimVersion, claimToken)
  const { data, error } = await api.rpc('release_claim', { p_listing_id: listingId, p_claim_version: claimVersion, p_claim_token: claimToken })
  if (error) mapRpcError(error)
  return data
}

export async function ownerReleaseClaim(listingId: string, expectedClaimVersion: string, ownerToken: string) {
  const { data, error } = await api.rpc('owner_release_claim', { p_listing_id: listingId, p_expected_claim_version: expectedClaimVersion, p_owner_token: ownerToken })
  if (error) mapRpcError(error)
  return data
}

export async function withdrawListing(listingId: string, ownerToken: string) {
  const { data, error } = await api.rpc('withdraw_listing', { p_listing_id: listingId, p_owner_token: ownerToken })
  if (error) mapRpcError(error)
  return data
}

export async function verifyPickupCode(listingId: string, expectedClaimVersion: string, ownerToken: string, pickupCode: string) {
  requirePickupCode(pickupCode)
  const { data, error } = await api.rpc('verify_pickup_code', {
    p_listing_id: listingId,
    p_expected_claim_version: expectedClaimVersion,
    p_owner_token: ownerToken,
    p_pickup_code: pickupCode,
  })
  if (error) mapRpcError(error)
  return data
}

export async function confirmCollected(listingId: string, expectedClaimVersion: string, ownerToken: string, pickupCode: string) {
  requirePickupCode(pickupCode)
  const { data, error } = await api.rpc('confirm_collected', {
    p_listing_id: listingId,
    p_expected_claim_version: expectedClaimVersion,
    p_owner_token: ownerToken,
    p_pickup_code: pickupCode,
  })
  if (error) mapRpcError(error)
  return data
}

export async function getOwnedListing(listingId: string, ownerToken: string) {
  const { data, error } = await api.rpc('get_owned_listing', { p_listing_id: listingId, p_owner_token: ownerToken })
  if (error) mapRpcError(error)
  return data
}

export async function getClaimReceipt(listingId: string, claimVersion: string, claimToken: string): Promise<ManagedClaimReceipt> {
  requireClaimSecret(listingId, claimVersion, claimToken)
  const { data, error } = await api.rpc('get_claim_receipt', { p_listing_id: listingId, p_claim_version: claimVersion, p_claim_token: claimToken })
  if (error) mapRpcError(error)
  return data as ManagedClaimReceipt
}
