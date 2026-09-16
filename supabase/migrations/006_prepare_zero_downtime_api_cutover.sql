-- JettyShare production cutover bridge.
--
-- Fresh DEV installs are already api-only after migrations 004/005. The
-- historical PROD project still has the legacy public RPC wrappers until the
-- hardening frontend is promoted. This migration creates/refreshes the final
-- api wrappers without removing the legacy public wrappers, then temporarily
-- exposes both schemas only when those legacy wrappers still exist.
--
-- Final state is enforced by 007_finalize_api_only.sql after the new frontend
-- is live. On a fresh install (where public wrappers are already gone), this
-- migration leaves PostgREST api-only.

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

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Close that
-- default, then grant only the frozen browser RPC surface.
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

-- Zero-downtime bridge for the historical production project only. If the
-- legacy public wrapper still exists, keep both schemas exposed while Vercel
-- moves from the old public-RPC frontend to the new api-RPC frontend. Fresh
-- installs have no public wrapper after migration 004 and remain api-only.
do $$
begin
  if to_regprocedure('public.get_board_snapshot()') is not null then
    execute 'alter role authenticator set pgrst.db_schemas = ''public,api''';
  else
    execute 'alter role authenticator set pgrst.db_schemas = ''api''';
  end if;
end
$$;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
