-- JettyShare production cutover finalizer.
-- Run after the hardening frontend that calls schema('api') is live and has
-- passed production smoke checks. This removes the temporary compatibility
-- surface and leaves the frozen Component 09 api-only Data API boundary.

drop function if exists public.create_listing(uuid,public.item_type,numeric,public.quantity_unit,text,text,integer,text);
drop function if exists public.claim_listing(uuid,text,uuid,text);
drop function if exists public.release_claim(uuid,uuid,text);
drop function if exists public.owner_release_claim(uuid,uuid,text);
drop function if exists public.confirm_collected(uuid,uuid,text);
drop function if exists public.get_board_snapshot();
drop function if exists public.get_owned_listing(uuid,text);
drop function if exists public.get_claim_receipt(uuid,uuid,text);

alter role authenticator set pgrst.db_schemas = 'api';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
