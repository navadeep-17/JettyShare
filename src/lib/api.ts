import { supabase } from './supabase'
import type { BoardSnapshot, ClaimReceipt, CreateListingInput } from './types'

export type JettyErrorCode =
  | 'INVALID_INPUT' | 'NOT_FOUND' | 'ITEM_EXPIRED' | 'CLAIM_UNAVAILABLE'
  | 'CLAIM_HOLD_EXPIRED' | 'STALE_CLAIM_VERSION' | 'CAPABILITY_INVALID'
  | 'ALREADY_COLLECTED' | 'CONFLICT' | 'NETWORK'

export class JettyError extends Error {
  constructor(public code: JettyErrorCode, message?: string) { super(message ?? code) }
}

function mapRpcError(error: { message?: string } | null): never {
  const message = error?.message ?? ''
  const codes: JettyErrorCode[] = ['INVALID_INPUT','NOT_FOUND','ITEM_EXPIRED','CLAIM_UNAVAILABLE','CLAIM_HOLD_EXPIRED','STALE_CLAIM_VERSION','CAPABILITY_INVALID','ALREADY_COLLECTED','CONFLICT']
  const code = codes.find((candidate) => message.includes(candidate))
  throw new JettyError(code ?? 'NETWORK', message)
}

export async function getBoardSnapshot(): Promise<BoardSnapshot> {
  const { data, error } = await supabase.rpc('get_board_snapshot')
  if (error) mapRpcError(error)
  return data as BoardSnapshot
}

export async function createListing(input: CreateListingInput, listingId: string, ownerToken: string) {
  const { data, error } = await supabase.rpc('create_listing', {
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
  const { data, error } = await supabase.rpc('claim_listing', {
    p_listing_id: listingId,
    p_claimant_label: claimantLabel,
    p_claim_version: claimVersion,
    p_claim_token: claimToken,
  })
  if (error) mapRpcError(error)
  return data as ClaimReceipt
}

export async function releaseClaim(listingId: string, claimVersion: string, claimToken: string) {
  const { data, error } = await supabase.rpc('release_claim', { p_listing_id: listingId, p_claim_version: claimVersion, p_claim_token: claimToken })
  if (error) mapRpcError(error)
  return data
}

export async function ownerReleaseClaim(listingId: string, expectedClaimVersion: string, ownerToken: string) {
  const { data, error } = await supabase.rpc('owner_release_claim', { p_listing_id: listingId, p_expected_claim_version: expectedClaimVersion, p_owner_token: ownerToken })
  if (error) mapRpcError(error)
  return data
}

export async function confirmCollected(listingId: string, expectedClaimVersion: string, ownerToken: string) {
  const { data, error } = await supabase.rpc('confirm_collected', { p_listing_id: listingId, p_expected_claim_version: expectedClaimVersion, p_owner_token: ownerToken })
  if (error) mapRpcError(error)
  return data
}

export async function getOwnedListing(listingId: string, ownerToken: string) {
  const { data, error } = await supabase.rpc('get_owned_listing', { p_listing_id: listingId, p_owner_token: ownerToken })
  if (error) mapRpcError(error)
  return data
}

export async function getClaimReceipt(listingId: string, claimVersion: string, claimToken: string) {
  const { data, error } = await supabase.rpc('get_claim_receipt', { p_listing_id: listingId, p_claim_version: claimVersion, p_claim_token: claimToken })
  if (error) mapRpcError(error)
  return data
}
