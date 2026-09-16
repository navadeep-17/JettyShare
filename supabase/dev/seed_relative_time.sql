-- DEV/LOCAL ONLY. Never run this file against production.
-- Re-runnable fixtures for sorting, expiry, no-show and copy-summary QA.

begin;

-- Fixed IDs make cleanup/reseed deterministic.
delete from private.listing_capabilities
 where listing_id in (
  '11111111-1111-4111-8111-111111111111'::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid,
  '33333333-3333-4333-8333-333333333333'::uuid,
  '44444444-4444-4444-8444-444444444444'::uuid
 );
delete from public.listings
 where id in (
  '11111111-1111-4111-8111-111111111111'::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid,
  '33333333-3333-4333-8333-333333333333'::uuid,
  '44444444-4444-4444-8444-444444444444'::uuid
 );

insert into public.listings(
  id,item_type,quantity_value,quantity_unit,berth,poster_label,
  stored_status,created_at,expires_at,updated_at
) values
  ('11111111-1111-4111-8111-111111111111','ICE',20,'KG','D-08','DEV Morning Star','ACTIVE',now()-interval '2 minutes',now()+interval '12 minutes',now()),
  ('22222222-2222-4222-8222-222222222222','BAIT',3,'BUCKET','D-11','DEV Sea Queen','ACTIVE',now()-interval '1 minute',now()+interval '42 minutes',now()),
  ('44444444-4444-4444-8444-444444444444','ICE',6,'KG','D-03','DEV Expired Boat','ACTIVE',now()-interval '40 minutes',now()-interval '1 minute',now());

-- Stored CLAIMED but hold already lapsed while supply remains fresh: effective ACTIVE.
insert into public.listings(
  id,item_type,quantity_value,quantity_unit,berth,poster_label,
  stored_status,created_at,expires_at,claimant_label,claimed_at,
  claim_expires_at,claim_version,updated_at
) values (
  '33333333-3333-4333-8333-333333333333','BAIT',2,'TRAY','D-14','DEV Harbor Fox',
  'CLAIMED',now()-interval '20 minutes',now()+interval '25 minutes','DEV No Show',
  now()-interval '16 minutes',now()-interval '1 minute',
  '33333333-aaaa-4bbb-8ccc-333333333333',now()
);

insert into private.listing_capabilities(listing_id,owner_token_hash,claim_token_hash,created_at,updated_at)
select id,
       private.token_digest('dev-owner-' || id::text || '-0123456789abcdef0123456789abcdef'),
       case when stored_status='CLAIMED'
            then private.token_digest('dev-old-claim-' || id::text || '-0123456789abcdef')
            else null end,
       now(),now()
  from public.listings
 where id in (
  '11111111-1111-4111-8111-111111111111'::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid,
  '33333333-3333-4333-8333-333333333333'::uuid,
  '44444444-4444-4444-8444-444444444444'::uuid
 );

commit;
