-- JettyShare Component 01/05/06 DEV-only timing and stale-generation assertions.
-- Uses privileged timestamp adjustment only inside a rollback transaction so the
-- production 15-minute hold is never changed for testing.

begin;

do $$
declare
  v_owner text := 'owner-' || gen_random_uuid()::text;
  v_claim1 text := 'claim1-' || gen_random_uuid()::text;
  v_claim2 text := 'claim2-' || gen_random_uuid()::text;
  v_claim3 text := 'claim3-' || gen_random_uuid()::text;
  v_id uuid := gen_random_uuid();
  v_expired_id uuid := gen_random_uuid();
  v_v1 uuid := gen_random_uuid();
  v_v2 uuid := gen_random_uuid();
  v_v3 uuid := gen_random_uuid();
  v_failed boolean;
begin
  -- REL-25: hold lapses while supply is still fresh -> effective ACTIVE, no cron/write required.
  perform public.create_listing(v_id, 'BAIT', 3, 'BUCKET', 'NS-01', 'Timing Provider', 60, v_owner);
  perform public.claim_listing(v_id, 'Timing Claimant 1', v_v1, v_claim1);
  update public.listings
     set claimed_at = now() - interval '10 minutes',
         claim_expires_at = now() - interval '1 minute'
   where id = v_id;

  if private.effective_status((select l from public.listings l where id=v_id), now()) <> 'ACTIVE' then
    raise exception 'ASSERT_REL25_NOSHOW_NOT_ACTIVE';
  end if;

  -- A new generation can claim the same fresh listing after the lapse.
  perform public.claim_listing(v_id, 'Timing Claimant 2', v_v2, v_claim2);

  -- REL-24 / REL-28: the old claimant/provider generation cannot mutate the newer reservation.
  v_failed := false;
  begin
    perform public.release_claim(v_id, v_v1, v_claim1);
  exception when others then
    v_failed := position('STALE_CLAIM_VERSION' in sqlerrm) > 0;
  end;
  if not v_failed then raise exception 'ASSERT_REL24_OLD_CLAIMANT_MUTATED_NEWER'; end if;

  v_failed := false;
  begin
    perform public.owner_release_claim(v_id, v_v1, v_owner);
  exception when others then
    v_failed := position('STALE_CLAIM_VERSION' in sqlerrm) > 0;
  end;
  if not v_failed then raise exception 'ASSERT_REL28_STALE_OWNER_RELEASE'; end if;

  v_failed := false;
  begin
    perform public.confirm_collected(v_id, v_v1, v_owner);
  exception when others then
    v_failed := position('STALE_CLAIM_VERSION' in sqlerrm) > 0;
  end;
  if not v_failed then raise exception 'ASSERT_REL28_STALE_OWNER_COLLECT'; end if;

  -- The current generation remains intact after stale attempts.
  if (select claim_version from public.listings where id=v_id) <> v_v2 then
    raise exception 'ASSERT_REL24_NEW_GENERATION_CHANGED';
  end if;

  -- REL-26 / REL-20: hold/spoil boundary resolves EXPIRED and a later claim is rejected.
  perform public.create_listing(v_expired_id, 'ICE', 8, 'KG', 'EX-01', 'Expiry Provider', 30, v_owner || '-x');
  perform public.claim_listing(v_expired_id, 'Expiry Claimant', v_v2, v_claim2 || '-x');

  update public.listings
     set created_at = now() - interval '31 minutes',
         expires_at = now() - interval '1 second',
         claimed_at = now() - interval '16 minutes',
         claim_expires_at = now() - interval '1 second'
   where id = v_expired_id;

  if private.effective_status((select l from public.listings l where id=v_expired_id), now()) <> 'EXPIRED' then
    raise exception 'ASSERT_REL26_EXPIRED_NOT_WINNER';
  end if;

  v_failed := false;
  begin
    perform public.claim_listing(v_expired_id, 'Late Claimant', v_v3, v_claim3);
  exception when others then
    v_failed := position('ITEM_EXPIRED' in sqlerrm) > 0;
  end;
  if not v_failed then raise exception 'ASSERT_REL20_LATE_CLAIM_ACCEPTED'; end if;
end $$;

select 'PASS' as dev_timing_and_stale_generation_tests;
rollback;
