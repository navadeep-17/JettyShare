-- JettyShare v1 hardening: close Component 01/02/05 contract gaps.
-- This is a forward migration; do not rewrite the already-deployed baseline migration.

create or replace function private.normalize_crew_label(p_label text)
returns text
language plpgsql
immutable
strict
security definer
set search_path=''
as $$
declare
  v_label text;
begin
  if p_label ~ '[[:cntrl:]]' then
    raise exception 'INVALID_INPUT';
  end if;

  v_label := regexp_replace(btrim(p_label), ' {2,}', ' ', 'g');
  if char_length(v_label) not between 1 and 40 then
    raise exception 'INVALID_INPUT';
  end if;
  return v_label;
end $$;

revoke all on function private.normalize_crew_label(text) from public, anon, authenticated;

create or replace function private.create_listing_impl(
  p_listing_id uuid,
  p_item_type public.item_type,
  p_quantity_value numeric,
  p_quantity_unit public.quantity_unit,
  p_berth text,
  p_poster_label text,
  p_spoil_minutes integer,
  p_owner_token text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_existing public.listings;
  v_existing_hash bytea;
  v_expires_at timestamptz;
  v_label text;
begin
  if p_listing_id is null or p_owner_token is null or length(p_owner_token) < 32 then raise exception 'INVALID_INPUT'; end if;
  if p_quantity_value is null or p_quantity_value <= 0 or scale(p_quantity_value) > 2 then raise exception 'INVALID_INPUT'; end if;
  if p_spoil_minutes is null or p_spoil_minutes < 5 or p_spoil_minutes > 360 then raise exception 'INVALID_INPUT'; end if;
  if char_length(btrim(coalesce(p_berth,''))) not between 1 and 12 then raise exception 'INVALID_INPUT'; end if;
  if p_poster_label is null then raise exception 'INVALID_INPUT'; end if;
  v_label := private.normalize_crew_label(p_poster_label);

  select * into v_existing from public.listings where id = p_listing_id;
  if found then
    select owner_token_hash into v_existing_hash from private.listing_capabilities where listing_id = p_listing_id;
    if v_existing_hash is null or v_existing_hash <> private.token_digest(p_owner_token) then raise exception 'CONFLICT'; end if;
    if v_existing.item_type <> p_item_type
      or v_existing.quantity_value <> p_quantity_value
      or v_existing.quantity_unit <> p_quantity_unit
      or v_existing.berth <> btrim(p_berth)
      or v_existing.poster_label <> v_label
      or v_existing.expires_at <> v_existing.created_at + make_interval(mins => p_spoil_minutes)
    then
      raise exception 'CONFLICT';
    end if;

    return jsonb_build_object(
      'id', v_existing.id,
      'item_type', v_existing.item_type,
      'quantity_value', v_existing.quantity_value,
      'quantity_unit', v_existing.quantity_unit,
      'berth', v_existing.berth,
      'poster_label', v_existing.poster_label,
      'created_at', v_existing.created_at,
      'expires_at', v_existing.expires_at,
      'effective_status', private.effective_status(v_existing, v_now)
    );
  end if;

  v_expires_at := v_now + make_interval(mins => p_spoil_minutes);
  insert into public.listings(
    id,item_type,quantity_value,quantity_unit,berth,poster_label,
    stored_status,created_at,expires_at,updated_at
  ) values (
    p_listing_id,p_item_type,p_quantity_value,p_quantity_unit,btrim(p_berth),v_label,
    'ACTIVE',v_now,v_expires_at,v_now
  ) returning * into v_existing;

  insert into private.listing_capabilities(listing_id,owner_token_hash,created_at,updated_at)
  values(p_listing_id,private.token_digest(p_owner_token),v_now,v_now);

  return jsonb_build_object(
    'id',v_existing.id,
    'item_type',v_existing.item_type,
    'quantity_value',v_existing.quantity_value,
    'quantity_unit',v_existing.quantity_unit,
    'berth',v_existing.berth,
    'poster_label',v_existing.poster_label,
    'created_at',v_existing.created_at,
    'expires_at',v_existing.expires_at,
    'effective_status','ACTIVE'
  );
end $$;

create or replace function private.claim_listing_impl(
  p_listing_id uuid,
  p_claimant_label text,
  p_claim_version uuid,
  p_claim_token text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_listing public.listings;
  v_claim_hash bytea;
  v_new_deadline timestamptz;
  v_label text;
begin
  if p_listing_id is null or p_claim_version is null or p_claim_token is null or length(p_claim_token) < 32 then raise exception 'INVALID_INPUT'; end if;
  if p_claimant_label is null then raise exception 'INVALID_INPUT'; end if;
  v_label := private.normalize_crew_label(p_claimant_label);

  select * into v_listing from public.listings where id = p_listing_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_listing.stored_status = 'COLLECTED' then raise exception 'ALREADY_COLLECTED'; end if;
  if v_listing.expires_at <= v_now then raise exception 'ITEM_EXPIRED'; end if;

  select claim_token_hash into v_claim_hash from private.listing_capabilities where listing_id = p_listing_id;
  if v_listing.stored_status = 'CLAIMED'
    and v_listing.claim_version = p_claim_version
    and v_claim_hash = private.token_digest(p_claim_token)
  then
    if v_listing.claim_expires_at <= v_now then raise exception 'CLAIM_HOLD_EXPIRED'; end if;
    return jsonb_build_object(
      'listing_id',v_listing.id,
      'claim_version',v_listing.claim_version,
      'item_type',v_listing.item_type,
      'quantity_value',v_listing.quantity_value,
      'quantity_unit',v_listing.quantity_unit,
      'berth',v_listing.berth,
      'poster_label',v_listing.poster_label,
      'claimant_label',v_listing.claimant_label,
      'claimed_at',v_listing.claimed_at,
      'claim_expires_at',v_listing.claim_expires_at,
      'expires_at',v_listing.expires_at,
      'server_now',v_now
    );
  end if;

  if v_listing.stored_status = 'CLAIMED' and v_listing.claim_expires_at > v_now then raise exception 'CLAIM_UNAVAILABLE'; end if;

  v_new_deadline := least(v_listing.expires_at, v_now + interval '15 minutes');
  update public.listings
     set stored_status='CLAIMED',
         claimant_label=v_label,
         claimed_at=v_now,
         claim_expires_at=v_new_deadline,
         claim_version=p_claim_version,
         collected_at=null,
         updated_at=v_now
   where id=p_listing_id
   returning * into v_listing;

  update private.listing_capabilities
     set claim_token_hash=private.token_digest(p_claim_token), updated_at=v_now
   where listing_id=p_listing_id;

  return jsonb_build_object(
    'listing_id',v_listing.id,
    'claim_version',v_listing.claim_version,
    'item_type',v_listing.item_type,
    'quantity_value',v_listing.quantity_value,
    'quantity_unit',v_listing.quantity_unit,
    'berth',v_listing.berth,
    'poster_label',v_listing.poster_label,
    'claimant_label',v_listing.claimant_label,
    'claimed_at',v_listing.claimed_at,
    'claim_expires_at',v_listing.claim_expires_at,
    'expires_at',v_listing.expires_at,
    'server_now',v_now
  );
end $$;

create or replace function private.get_claim_receipt_impl(
  p_listing_id uuid,
  p_claim_version uuid,
  p_claim_token text
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_listing public.listings;
  v_hash bytea;
begin
  select * into v_listing from public.listings where id = p_listing_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select claim_token_hash into v_hash from private.listing_capabilities where listing_id = p_listing_id;
  if v_listing.claim_version <> p_claim_version then raise exception 'STALE_CLAIM_VERSION'; end if;
  if v_hash is null or v_hash <> private.token_digest(p_claim_token) then raise exception 'CAPABILITY_INVALID'; end if;

  return jsonb_build_object(
    'listing_id',v_listing.id,
    'item_type',v_listing.item_type,
    'quantity_value',v_listing.quantity_value,
    'quantity_unit',v_listing.quantity_unit,
    'berth',v_listing.berth,
    'poster_label',v_listing.poster_label,
    'claimant_label',v_listing.claimant_label,
    'claim_version',v_listing.claim_version,
    'claimed_at',v_listing.claimed_at,
    'claim_expires_at',v_listing.claim_expires_at,
    'expires_at',v_listing.expires_at,
    'effective_status',private.effective_status(v_listing,v_now),
    'server_now',v_now
  );
end $$;
