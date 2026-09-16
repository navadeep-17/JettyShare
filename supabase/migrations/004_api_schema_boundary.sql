-- JettyShare Component 09 hardening.
-- Move the browser-callable RPC surface into an explicit api schema and make
-- PostgREST expose that schema only. Authoritative tables stay in public and
-- capability data/private implementations stay outside the Data API surface.

create schema if not exists api;

revoke all on schema api from public;
grant usage on schema api to anon, authenticated;

create or replace function api.create_listing(
  p_listing_id uuid,
  p_item_type public.item_type,
  p_quantity_value numeric,
  p_quantity_unit public.quantity_unit,
  p_berth text,
  p_poster_label text,
  p_spoil_minutes integer,
  p_owner_token text
) returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.create_listing_impl(
    p_listing_id,p_item_type,p_quantity_value,p_quantity_unit,
    p_berth,p_poster_label,p_spoil_minutes,p_owner_token
  )
$$;

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
  select private.claim_listing_impl(p_listing_id,p_claimant_label,p_claim_version,p_claim_token)
$$;

create or replace function api.release_claim(
  p_listing_id uuid,
  p_claim_version uuid,
  p_claim_token text
) returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.release_claim_impl(p_listing_id,p_claim_version,p_claim_token)
$$;

create or replace function api.owner_release_claim(
  p_listing_id uuid,
  p_expected_claim_version uuid,
  p_owner_token text
) returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.owner_release_claim_impl(p_listing_id,p_expected_claim_version,p_owner_token)
$$;

create or replace function api.confirm_collected(
  p_listing_id uuid,
  p_expected_claim_version uuid,
  p_owner_token text
) returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.confirm_collected_impl(p_listing_id,p_expected_claim_version,p_owner_token)
$$;

create or replace function api.get_board_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$
  select private.get_board_snapshot_impl()
$$;

create or replace function api.get_owned_listing(
  p_listing_id uuid,
  p_owner_token text
) returns jsonb
language sql
stable
security invoker
set search_path=''
as $$
  select private.get_owned_listing_impl(p_listing_id,p_owner_token)
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
  select private.get_claim_receipt_impl(p_listing_id,p_claim_version,p_claim_token)
$$;

-- Functions are executable by PUBLIC by default in PostgreSQL. Close that
-- default first, then grant only the frozen browser surface explicitly.
revoke all on all functions in schema api from public, anon, authenticated;
alter default privileges for role postgres in schema api revoke execute on functions from public;

grant execute on function api.create_listing(uuid,public.item_type,numeric,public.quantity_unit,text,text,integer,text) to anon, authenticated;
grant execute on function api.claim_listing(uuid,text,uuid,text) to anon, authenticated;
grant execute on function api.release_claim(uuid,uuid,text) to anon, authenticated;
grant execute on function api.owner_release_claim(uuid,uuid,text) to anon, authenticated;
grant execute on function api.confirm_collected(uuid,uuid,text) to anon, authenticated;
grant execute on function api.get_board_snapshot() to anon, authenticated;
grant execute on function api.get_owned_listing(uuid,text) to anon, authenticated;
grant execute on function api.get_claim_receipt(uuid,uuid,text) to anon, authenticated;

-- Retire the old public RPC surface. The private implementations remain the
-- guarded business layer and are reachable only through server-side SQL calls
-- from the api wrappers; the private schema itself is not exposed by PostgREST.
drop function if exists public.create_listing(uuid,public.item_type,numeric,public.quantity_unit,text,text,integer,text);
drop function if exists public.claim_listing(uuid,text,uuid,text);
drop function if exists public.release_claim(uuid,uuid,text);
drop function if exists public.owner_release_claim(uuid,uuid,text);
drop function if exists public.confirm_collected(uuid,uuid,text);
drop function if exists public.get_board_snapshot();
drop function if exists public.get_owned_listing(uuid,text);
drop function if exists public.get_claim_receipt(uuid,uuid,text);

-- Explicitly pin the Data API to the small api schema. This is equivalent to
-- configuring api as the sole Exposed Schema in Supabase Data API settings.
alter role authenticator set pgrst.db_schemas = 'api';
notify pgrst, 'reload config';
