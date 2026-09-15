export type ItemType = 'ICE' | 'BAIT'
export type QuantityUnit = 'KG' | 'BUCKET' | 'TRAY' | 'BOX'

export type ActiveBoardItem = {
  id: string
  item_type: ItemType
  quantity_value: number
  quantity_unit: QuantityUnit
  berth: string
  poster_label: string
  created_at: string
  expires_at: string
}

export type BoardSnapshot = {
  server_now: string
  next_transition_at: string | null
  items: ActiveBoardItem[]
}

export type LocalProfileV1 = {
  crewLabel: string
  updatedAt: string
}

export type OwnedListingLocalV1 = {
  ownerToken: string
  state: 'pending-create' | 'managed'
  createPayload?: CreateListingInput
  createdLocallyAt: string
}

export type ClaimLocalV1 = {
  claimVersion: string
  claimToken: string
  claimantLabel?: string
  state: 'pending-claim' | 'held'
  requestedLocallyAt: string
  claimExpiresAt?: string
  itemExpiresAt?: string
}

export type CreateListingInput = {
  itemType: ItemType
  quantityValue: number
  quantityUnit: QuantityUnit
  berth: string
  spoilMinutes: number
  posterLabel: string
}

export type ClaimReceipt = {
  listing_id: string
  claim_version: string
  berth: string
  claimed_at: string
  claim_expires_at: string
  expires_at: string
  server_now: string
}
