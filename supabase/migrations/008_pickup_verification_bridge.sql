-- JettyShare Pickup Verification v1.1 bridge migration.
-- Adds a claim-bound four-digit pickup proof while retaining the legacy
-- three-argument confirm_collected RPC temporarily for zero-downtime cutover.

create or replace function private.pickup_code_from_claim_hash(p_hash bytea)
returns text
language sql
immutable
strict
set search_path=''
as $$
  select lpad((((get_byte(p_hash,0) * 256) + get_byte(p_hash,1)) % 10000)::text, 4, '0')
$$;

revoke all on function private.pickup_code_from_claim_hash(bytea) from public, anon, authenticated;

create or replace function private.claim_listing_with_pickup_impl(
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
  v_receipt jsonb;
  v_hash bytea;
begin
  v_receipt := private.claim_listing_impl(p_listing_id,p_claimant_label,p_claim_version,p_claim_token);
  select claim_token_hash into v_hash
    from private.listing_capabilities
   where listing_id = p_listing_id;
  if v_hash is null then raise exception 'CAPABILITY_INVALID'; end if;
  return v_receipt || jsonb_build_object('pickup_code', private.pickup_code_from_claim_hash(v_hash));
end
$$;

create or replace function private.get_claim_receipt_with_pickup_impl(
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
  v_receipt jsonb;
  v_hash bytea;
begin
  v_receipt := private.get_claim_receipt_impl(p_listing_id,p_claim_version,p_claim_token);
  select claim_token_hash into v_hash
    from private.listing_capabilities
   where listing_id = p_listing_id;
  if v_hash is null then raise exception 'CAPABILITY_INVALID'; end if;
  return v_receipt || jsonb_build_object('pickup_code', private.pickup_code_from_claim_hash(v_hash));
end
$$;

create or replace function private.verify_pickup_code_impl(
  p_listing_id uuid,
  p_expected_claim_version uuid,
  p_owner_token text,
  p_pickup_code text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_listing public.listings;
  v_owner_hash bytea;
  v_claim_hash bytea;
begin
  select * into v_listing
    from public.listings
   where id = p_listing_id
   for update;

  if not found then raise exception 'NOT_FOUND'; end if;
  if v_listing.stored_status = 'COLLECTED' then raise exception 'ALREADY_COLLECTED'; end if;
  if v_listing.expires_at <= v_now then raise exception 'ITEM_EXPIRED'; end if;
  if v_listing.stored_status <> 'CLAIMED' then raise exception 'CLAIM_UNAVAILABLE'; end if;
  if v_listing.claim_version <> p_expected_claim_version then raise exception 'STALE_CLAIM_VERSION'; end if;
  if v_listing.claim_expires_at <= v_now then raise exception 'CLAIM_HOLD_EXPIRED'; end if;

  select owner_token_hash, claim_token_hash
    into v_owner_hash, v_claim_hash
    from private.listing_capabilities
   where listing_id = p_listing_id;

  if v_owner_hash is null or v_owner_hash <> private.token_digest(p_owner_token) then
    raise exception 'CAPABILITY_INVALID';
  end if;

  if v_claim_hash is null
     or p_pickup_code is null
     or p_pickup_code !~ '^[0-9]{4}$'
     or p_pickup_code <> private.pickup_code_from_claim_hash(v_claim_hash)
  then
    raise exception 'PICKUP_CODE_INVALID';
  end if;

  return jsonb_build_object(
    'verified', true,
    'claimant_label', v_listing.claimant_label,
    'claim_version', v_listing.claim_version,
    'server_now', v_now
  );
end
$$;

create or replace function private.confirm_collected_verified_impl(
  p_listing_id uuid,
  p_expected_claim_version uuid,
  p_owner_token text,
  p_pickup_code text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_listing public.listings;
  v_owner_hash bytea;
  v_claim_hash bytea;
begin
  select * into v_listing
    from public.listings
   where id = p_listing_id
   for update;

  if not found then raise exception 'NOT_FOUND'; end if;
  if v_listing.stored_status = 'COLLECTED' then raise exception 'ALREADY_COLLECTED'; end if;
  if v_listing.expires_at <= v_now then raise exception 'ITEM_EXPIRED'; end if;
  if v_listing.stored_status <> 'CLAIMED' then raise exception 'CLAIM_UNAVAILABLE'; end if;
  if v_listing.claim_version <> p_expected_claim_version then raise exception 'STALE_CLAIM_VERSION'; end if;
  if v_listing.claim_expires_at <= v_now then raise exception 'CLAIM_HOLD_EXPIRED'; end if;

  select owner_token_hash, claim_token_hash
    into v_owner_hash, v_claim_hash
    from private.listing_capabilities
   where listing_id = p_listing_id;

  if v_owner_hash is null or v_owner_hash <> private.token_digest(p_owner_token) then
    raise exception 'CAPABILITY_INVALID';
  end if;

  if v_claim_hash is null
     or p_pickup_code is null
     or p_pickup_code !~ '^[0-9]{4}$'
     or p_pickup_code <> private.pickup_code_from_claim_hash(v_claim_hash)
  then
    raise exception 'PICKUP_CODE_INVALID';
  end if;

  update public.listings
     set stored_status = 'COLLECTED',
         collected_at = v_now,
         updated_at = v_now
   where id = p_listing_id
   returning * into v_listing;

  return jsonb_build_object('collected',true,'collected_at',v_listing.collected_at,'server_now',v_now);
end
$$;

revoke all on function private.claim_listing_with_pickup_impl(uuid,text,uuid,text) from public, anon, authenticated;
revoke all on function private.get_claim_receipt_with_pickup_impl(uuid,uuid,text) from public, anon, authenticated;
revoke all on function private.verify_pickup_code_impl(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function private.confirm_collected_verified_impl(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function private.claim_listing_with_pickup_impl(uuid,text,uuid,text) to anon;
grant execute on function private.get_claim_receipt_with_pickup_impl(uuid,uuid,text) to anon;
grant execute on function private.verify_pickup_code_impl(uuid,uuid,text,text) to anon;
grant execute on function private.confirm_collected_verified_impl(uuid,uuid,text,text) to anon;

create or replace function api.claim_listing(
  p_listing_id uuid,
  p_claimant_label text,
  p_claim_version uuid,
  p_claim_token text
) returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.claim_listing_with_pickup_impl(p_listing_id,p_claimant_label,p_claim_version,p_claim_token)
$$;

create or replace function api.get_claim_receipt(
  p_listing_id uuid,
  p_claim_version uuid,
  p_claim_token text
) returns jsonb
language sql
stable
security invoker
set search_path=''
as $$
  select private.get_claim_receipt_with_pickup_impl(p_listing_id,p_claim_version,p_claim_token)
$$;

create or replace function api.verify_pickup_code(
  p_listing_id uuid,
  p_expected_claim_version uuid,
  p_owner_token text,
  p_pickup_code text
) returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.verify_pickup_code_impl(p_listing_id,p_expected_claim_version,p_owner_token,p_pickup_code)
$$;

create or replace function api.confirm_collected(
  p_listing_id uuid,
  p_expected_claim_version uuid,
  p_owner_token text,
  p_pickup_code text
) returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.confirm_collected_verified_impl(p_listing_id,p_expected_claim_version,p_owner_token,p_pickup_code)
$$;

revoke all on function api.claim_listing(uuid,text,uuid,text) from public, anon, authenticated;
revoke all on function api.get_claim_receipt(uuid,uuid,text) from public, anon, authenticated;
revoke all on function api.verify_pickup_code(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function api.confirm_collected(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function api.claim_listing(uuid,text,uuid,text) to anon, authenticated;
grant execute on function api.get_claim_receipt(uuid,uuid,text) to anon, authenticated;
grant execute on function api.verify_pickup_code(uuid,uuid,text,text) to anon, authenticated;
grant execute on function api.confirm_collected(uuid,uuid,text,text) to anon, authenticated;

notify pgrst, 'reload schema';
