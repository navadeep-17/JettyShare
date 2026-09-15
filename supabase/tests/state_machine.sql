-- JettyShare Component 01/06 lifecycle integration assertions.
-- Run with a privileged test connection against DEV/local. The transaction rolls back.

begin;

do $$
declare
  v_id uuid := gen_random_uuid();
  v_version1 uuid := gen_random_uuid();
  v_version2 uuid := gen_random_uuid();
  v_owner text := 'test-owner-' || gen_random_uuid()::text;
  v_claim1 text := 'test-claim-1-' || gen_random_uuid()::text;
  v_claim2 text := 'test-claim-2-' || gen_random_uuid()::text;
  v_first jsonb;
  v_retry jsonb;
  v_now timestamptz := now();
  v_failed boolean;
begin
  -- DB-01 / DB-05: create and claim a fresh listing.
  perform public.create_listing(v_id, 'ICE', 12.50, 'KG', 'T-01', 'QA Provider', 60, v_owner);
  v_first := public.claim_listing(v_id, 'QA Claimant A', v_version1, v_claim1);

  if (v_first->>'listing_id')::uuid <> v_id then raise exception 'ASSERT_DB05_LISTING'; end if;
  if (v_first->>'claim_version')::uuid <> v_version1 then raise exception 'ASSERT_DB05_VERSION'; end if;
  if (v_first->>'claim_expires_at')::timestamptz > (v_first->>'expires_at')::timestamptz then raise exception 'ASSERT_HOLD_CAP'; end if;
  if (v_first->>'claim_expires_at')::timestamptz > (v_first->>'claimed_at')::timestamptz + interval '15 minutes' then raise exception 'ASSERT_HOLD_MAX'; end if;

  -- DB-07: identical retry returns identical hold timestamps.
  v_retry := public.claim_listing(v_id, 'QA Claimant A', v_version1, v_claim1);
  if v_retry->>'claimed_at' <> v_first->>'claimed_at' then raise exception 'ASSERT_RETRY_CLAIMED_AT'; end if;
  if v_retry->>'claim_expires_at' <> v_first->>'claim_expires_at' then raise exception 'ASSERT_RETRY_EXTENDED_HOLD'; end if;

  -- DB-08: another generation cannot claim during the live hold.
  v_failed := false;
  begin
    perform public.claim_listing(v_id, 'QA Claimant B', v_version2, v_claim2);
  exception when others then
    v_failed := position('CLAIM_UNAVAILABLE' in sqlerrm) > 0;
  end;
  if not v_failed then raise exception 'ASSERT_ACTIVE_HOLD_BLOCKS'; end if;

  -- DB-23: wrong claimant token cannot release.
  v_failed := false;
  begin
    perform public.release_claim(v_id, v_version1, 'wrong-token');
  exception when others then
    v_failed := position('CAPABILITY_INVALID' in sqlerrm) > 0;
  end;
  if not v_failed then raise exception 'ASSERT_WRONG_TOKEN_DENIED'; end if;

  -- DB-12: current claimant can release while fresh.
  perform public.release_claim(v_id, v_version1, v_claim1);
  if private.effective_status((select l from public.listings l where id=v_id), now()) <> 'ACTIVE' then
    raise exception 'ASSERT_RELEASE_ACTIVE';
  end if;

  -- DB-19: a stale stored claim becomes effectively ACTIVE without a write.
  update public.listings
     set stored_status='CLAIMED', claimant_label='QA Claimant B', claimed_at=v_now-interval '20 minutes',
         claim_expires_at=v_now-interval '5 minutes', claim_version=v_version2,
         expires_at=v_now+interval '30 minutes'
   where id=v_id;
  if private.effective_status((select l from public.listings l where id=v_id), v_now) <> 'ACTIVE' then
    raise exception 'ASSERT_NOSHOW_REOPENS';
  end if;

  -- DB-20 / boundary: spoil wins even if the stale hold would otherwise reopen.
  update public.listings set expires_at=v_now-interval '1 second' where id=v_id;
  if private.effective_status((select l from public.listings l where id=v_id), v_now) <> 'EXPIRED' then
    raise exception 'ASSERT_SPOIL_WINS';
  end if;
end $$;

rollback;
