-- JettyShare Activity + Withdrawal v1.2.
-- Adds an owner-authorized terminal withdrawal path without making published
-- listings editable. Withdrawal preserves the current claim lineage long enough
-- for an authorized claimant to observe that the provider ended the supply.

alter table public.listings
  add column if not exists withdrawn_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'listings_withdrawn_at_consistency'
      and conrelid = 'public.listings'::regclass
  ) then
    alter table public.listings
      add constraint listings_withdrawn_at_consistency
      check (withdrawn_at is null or (withdrawn_at >= created_at and collected_at is null));
  end if;
end
$$;

-- Keep the existing parameter name `p` so CREATE OR REPLACE remains compatible
-- with already-deployed environments where PostgreSQL records that input name.
create or replace function private.effective_status(p public.listings, p_now timestamptz)
returns text
language sql
immutable
security definer
set search_path=''
as $$
  select case
    when p.withdrawn_at is not null then 'WITHDRAWN'
    when p.stored_status='COLLECTED' then 'COLLECTED'
    when p.expires_at <= p_now then 'EXPIRED'
    when p.stored_status='CLAIMED' and p.claim_expires_at > p_now then 'CLAIMED'
    else 'ACTIVE'
  end
$$;

revoke all on function private.effective_status(public.listings,timestamptz) from public, anon, authenticated;

create or replace function private.withdraw_listing_impl(
  p_listing_id uuid,
  p_owner_token text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_listing public.listings;
  v_owner_hash bytea;
  v_had_claim boolean;
begin
  select * into v_listing
    from public.listings
   where id = p_listing_id
   for update;

  if not found then raise exception 'NOT_FOUND'; end if;

  select owner_token_hash into v_owner_hash
    from private.listing_capabilities
   where listing_id = p_listing_id;

  if v_owner_hash is null or v_owner_hash <> private.token_digest(p_owner_token) then
    raise exception 'CAPABILITY_INVALID';
  end if;

  if v_listing.withdrawn_at is not null then
    return jsonb_build_object(
      'withdrawn', true,
      'withdrawn_at', v_listing.withdrawn_at,
      'had_claim', v_listing.claim_version is not null,
      'claimant_label', v_listing.claimant_label,
      'claim_version', v_listing.claim_version,
      'server_now', v_now
    );
  end if;

  if v_listing.stored_status = 'COLLECTED' then raise exception 'ALREADY_COLLECTED'; end if;
  if v_listing.expires_at <= v_now then raise exception 'ITEM_EXPIRED'; end if;

  v_had_claim := v_listing.stored_status = 'CLAIMED' and v_listing.claim_version is not null;

  update public.listings
     set withdrawn_at = v_now,
         expires_at = v_now,
         claim_expires_at = case when v_had_claim then v_now else claim_expires_at end,
         updated_at = v_now
   where id = p_listing_id
   returning * into v_listing;

  return jsonb_build_object(
    'withdrawn', true,
    'withdrawn_at', v_listing.withdrawn_at,
    'had_claim', v_had_claim,
    'claimant_label', v_listing.claimant_label,
    'claim_version', v_listing.claim_version,
    'server_now', v_now
  );
end
$$;

revoke all on function private.withdraw_listing_impl(uuid,text) from public, anon, authenticated;
grant execute on function private.withdraw_listing_impl(uuid,text) to anon;

create or replace function api.withdraw_listing(
  p_listing_id uuid,
  p_owner_token text
) returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.withdraw_listing_impl(p_listing_id,p_owner_token)
$$;

revoke all on function api.withdraw_listing(uuid,text) from public, anon, authenticated;
grant execute on function api.withdraw_listing(uuid,text) to anon, authenticated;

notify pgrst, 'reload schema';
