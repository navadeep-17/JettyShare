-- JettyShare Pickup Verification v1.1 final cutover.
-- Remove the legacy collection path so every terminal collection requires the
-- current pickup proof server-side.

revoke all on function api.confirm_collected(uuid,uuid,text) from public, anon, authenticated;
drop function if exists api.confirm_collected(uuid,uuid,text);

revoke all on function private.confirm_collected_impl(uuid,uuid,text) from public, anon, authenticated;
drop function if exists private.confirm_collected_impl(uuid,uuid,text);

revoke all on function api.verify_pickup_code(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function api.confirm_collected(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function api.verify_pickup_code(uuid,uuid,text,text) to anon, authenticated;
grant execute on function api.confirm_collected(uuid,uuid,text,text) to anon, authenticated;

notify pgrst, 'reload schema';
