-- JettyShare v1 canonical database bootstrap.
-- The hosted challenge project was evolved through three migrations; this file
-- represents the final reproducible schema and API contract in one place.

create extension if not exists pgcrypto;
create schema if not exists private;

create type public.item_type as enum ('ICE','BAIT');
create type public.quantity_unit as enum ('KG','BUCKET','TRAY','BOX');
create type public.listing_status as enum ('ACTIVE','CLAIMED','COLLECTED');

create table public.listings (
  id uuid primary key,
  item_type public.item_type not null,
  quantity_value numeric not null check (quantity_value > 0),
  quantity_unit public.quantity_unit not null,
  berth text not null check (char_length(btrim(berth)) between 1 and 12),
  poster_label text not null check (char_length(btrim(poster_label)) between 1 and 40),
  stored_status public.listing_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimant_label text check (claimant_label is null or char_length(btrim(claimant_label)) between 1 and 40),
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  claim_version uuid,
  collected_at timestamptz,
  updated_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (claim_expires_at is null or claim_expires_at <= expires_at),
  check (collected_at is null or collected_at <= expires_at),
  check (
    (stored_status='ACTIVE' and claimant_label is null and claimed_at is null and claim_expires_at is null and claim_version is null and collected_at is null)
    or
    (stored_status='CLAIMED' and claimant_label is not null and claimed_at is not null and claim_expires_at is not null and claim_version is not null and collected_at is null)
    or
    (stored_status='COLLECTED' and claimant_label is not null and claimed_at is not null and claim_expires_at is not null and claim_version is not null and collected_at is not null)
  )
);

create table private.listing_capabilities (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  owner_token_hash bytea not null,
  claim_token_hash bytea,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index listings_board_idx on public.listings(expires_at,created_at,id) where stored_status <> 'COLLECTED';
create index listings_claim_deadline_idx on public.listings(claim_expires_at) where stored_status='CLAIMED';
create index listings_updated_idx on public.listings(updated_at desc);

alter table public.listings enable row level security;
alter table private.listing_capabilities enable row level security;
revoke all on public.listings from anon, authenticated;
revoke all on private.listing_capabilities from anon, authenticated;

create function private.token_digest(p_token text)
returns bytea language sql immutable strict security definer set search_path='' as $$
  select extensions.digest(convert_to(p_token,'UTF8'),'sha256')
$$;

create function private.effective_status(p_listing public.listings, p_now timestamptz)
returns text language sql immutable security definer set search_path='' as $$
  select case
    when p_listing.stored_status='COLLECTED' then 'COLLECTED'
    when p_listing.expires_at <= p_now then 'EXPIRED'
    when p_listing.stored_status='CLAIMED' and p_listing.claim_expires_at > p_now then 'CLAIMED'
    else 'ACTIVE'
  end
$$;

create function private.create_listing_impl(
  p_listing_id uuid,
  p_item_type public.item_type,
  p_quantity_value numeric,
  p_quantity_unit public.quantity_unit,
  p_berth text,
  p_poster_label text,
  p_spoil_minutes integer,
  p_owner_token text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_existing public.listings;
  v_existing_hash bytea;
  v_expires_at timestamptz;
begin
  if p_listing_id is null or p_owner_token is null or length(p_owner_token)<32 then raise exception 'INVALID_INPUT'; end if;
  if p_quantity_value is null or p_quantity_value<=0 or scale(p_quantity_value)>2 then raise exception 'INVALID_INPUT'; end if;
  if p_spoil_minutes is null or p_spoil_minutes<5 or p_spoil_minutes>360 then raise exception 'INVALID_INPUT'; end if;
  if char_length(btrim(coalesce(p_berth,''))) not between 1 and 12 or char_length(btrim(coalesce(p_poster_label,''))) not between 1 and 40 then raise exception 'INVALID_INPUT'; end if;

  select * into v_existing from public.listings where id=p_listing_id;
  if found then
    select owner_token_hash into v_existing_hash from private.listing_capabilities where listing_id=p_listing_id;
    if v_existing_hash <> private.token_digest(p_owner_token) then raise exception 'CONFLICT'; end if;
    if v_existing.item_type<>p_item_type or v_existing.quantity_value<>p_quantity_value or v_existing.quantity_unit<>p_quantity_unit or v_existing.berth<>btrim(p_berth) or v_existing.poster_label<>btrim(p_poster_label) then raise exception 'CONFLICT'; end if;
    return jsonb_build_object('id',v_existing.id,'item_type',v_existing.item_type,'quantity_value',v_existing.quantity_value,'quantity_unit',v_existing.quantity_unit,'berth',v_existing.berth,'poster_label',v_existing.poster_label,'created_at',v_existing.created_at,'expires_at',v_existing.expires_at,'effective_status',private.effective_status(v_existing,v_now));
  end if;

  v_expires_at := v_now + make_interval(mins=>p_spoil_minutes);
  insert into public.listings(id,item_type,quantity_value,quantity_unit,berth,poster_label,stored_status,created_at,expires_at,updated_at)
  values(p_listing_id,p_item_type,p_quantity_value,p_quantity_unit,btrim(p_berth),btrim(p_poster_label),'ACTIVE',v_now,v_expires_at,v_now)
  returning * into v_existing;
  insert into private.listing_capabilities(listing_id,owner_token_hash,created_at,updated_at)
  values(p_listing_id,private.token_digest(p_owner_token),v_now,v_now);
  return jsonb_build_object('id',v_existing.id,'item_type',v_existing.item_type,'quantity_value',v_existing.quantity_value,'quantity_unit',v_existing.quantity_unit,'berth',v_existing.berth,'poster_label',v_existing.poster_label,'created_at',v_existing.created_at,'expires_at',v_existing.expires_at,'effective_status','ACTIVE');
end $$;

create function private.claim_listing_impl(p_listing_id uuid,p_claimant_label text,p_claim_version uuid,p_claim_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_listing public.listings;
  v_claim_hash bytea;
  v_new_deadline timestamptz;
begin
  if p_listing_id is null or p_claim_version is null or p_claim_token is null or length(p_claim_token)<32 or char_length(btrim(coalesce(p_claimant_label,''))) not between 1 and 40 then raise exception 'INVALID_INPUT'; end if;
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_listing.stored_status='COLLECTED' then raise exception 'ALREADY_COLLECTED'; end if;
  if v_listing.expires_at<=v_now then raise exception 'ITEM_EXPIRED'; end if;
  select claim_token_hash into v_claim_hash from private.listing_capabilities where listing_id=p_listing_id;
  if v_listing.stored_status='CLAIMED' and v_listing.claim_version=p_claim_version and v_claim_hash=private.token_digest(p_claim_token) then
    if v_listing.claim_expires_at<=v_now then raise exception 'CLAIM_HOLD_EXPIRED'; end if;
    return jsonb_build_object('listing_id',v_listing.id,'claim_version',v_listing.claim_version,'berth',v_listing.berth,'claimed_at',v_listing.claimed_at,'claim_expires_at',v_listing.claim_expires_at,'expires_at',v_listing.expires_at,'server_now',v_now);
  end if;
  if v_listing.stored_status='CLAIMED' and v_listing.claim_expires_at>v_now then raise exception 'CLAIM_UNAVAILABLE'; end if;
  v_new_deadline:=least(v_listing.expires_at,v_now+interval '15 minutes');
  update public.listings set stored_status='CLAIMED',claimant_label=btrim(p_claimant_label),claimed_at=v_now,claim_expires_at=v_new_deadline,claim_version=p_claim_version,collected_at=null,updated_at=v_now where id=p_listing_id returning * into v_listing;
  update private.listing_capabilities set claim_token_hash=private.token_digest(p_claim_token),updated_at=v_now where listing_id=p_listing_id;
  return jsonb_build_object('listing_id',v_listing.id,'claim_version',v_listing.claim_version,'berth',v_listing.berth,'claimed_at',v_listing.claimed_at,'claim_expires_at',v_listing.claim_expires_at,'expires_at',v_listing.expires_at,'server_now',v_now);
end $$;

create function private.release_claim_impl(p_listing_id uuid,p_claim_version uuid,p_claim_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp(); v_listing public.listings; v_hash bytea;
begin
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_listing.stored_status='COLLECTED' then raise exception 'ALREADY_COLLECTED'; end if;
  if v_listing.expires_at<=v_now then raise exception 'ITEM_EXPIRED'; end if;
  if v_listing.stored_status<>'CLAIMED' then raise exception 'CLAIM_UNAVAILABLE'; end if;
  if v_listing.claim_version<>p_claim_version then raise exception 'STALE_CLAIM_VERSION'; end if;
  if v_listing.claim_expires_at<=v_now then raise exception 'CLAIM_HOLD_EXPIRED'; end if;
  select claim_token_hash into v_hash from private.listing_capabilities where listing_id=p_listing_id;
  if v_hash is null or v_hash<>private.token_digest(p_claim_token) then raise exception 'CAPABILITY_INVALID'; end if;
  update public.listings set stored_status='ACTIVE',claimant_label=null,claimed_at=null,claim_expires_at=null,claim_version=null,updated_at=v_now where id=p_listing_id;
  update private.listing_capabilities set claim_token_hash=null,updated_at=v_now where listing_id=p_listing_id;
  return jsonb_build_object('released',true,'server_now',v_now);
end $$;

create function private.owner_release_claim_impl(p_listing_id uuid,p_expected_claim_version uuid,p_owner_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp(); v_listing public.listings; v_hash bytea;
begin
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_listing.stored_status='COLLECTED' then raise exception 'ALREADY_COLLECTED'; end if;
  if v_listing.expires_at<=v_now then raise exception 'ITEM_EXPIRED'; end if;
  if v_listing.stored_status<>'CLAIMED' then raise exception 'CLAIM_UNAVAILABLE'; end if;
  if v_listing.claim_version<>p_expected_claim_version then raise exception 'STALE_CLAIM_VERSION'; end if;
  if v_listing.claim_expires_at<=v_now then raise exception 'CLAIM_HOLD_EXPIRED'; end if;
  select owner_token_hash into v_hash from private.listing_capabilities where listing_id=p_listing_id;
  if v_hash is null or v_hash<>private.token_digest(p_owner_token) then raise exception 'CAPABILITY_INVALID'; end if;
  update public.listings set stored_status='ACTIVE',claimant_label=null,claimed_at=null,claim_expires_at=null,claim_version=null,updated_at=v_now where id=p_listing_id;
  update private.listing_capabilities set claim_token_hash=null,updated_at=v_now where listing_id=p_listing_id;
  return jsonb_build_object('released',true,'server_now',v_now);
end $$;

create function private.confirm_collected_impl(p_listing_id uuid,p_expected_claim_version uuid,p_owner_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp(); v_listing public.listings; v_hash bytea;
begin
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_listing.stored_status='COLLECTED' then raise exception 'ALREADY_COLLECTED'; end if;
  if v_listing.expires_at<=v_now then raise exception 'ITEM_EXPIRED'; end if;
  if v_listing.stored_status<>'CLAIMED' then raise exception 'CLAIM_UNAVAILABLE'; end if;
  if v_listing.claim_version<>p_expected_claim_version then raise exception 'STALE_CLAIM_VERSION'; end if;
  if v_listing.claim_expires_at<=v_now then raise exception 'CLAIM_HOLD_EXPIRED'; end if;
  select owner_token_hash into v_hash from private.listing_capabilities where listing_id=p_listing_id;
  if v_hash is null or v_hash<>private.token_digest(p_owner_token) then raise exception 'CAPABILITY_INVALID'; end if;
  update public.listings set stored_status='COLLECTED',collected_at=v_now,updated_at=v_now where id=p_listing_id returning * into v_listing;
  return jsonb_build_object('collected',true,'collected_at',v_listing.collected_at,'server_now',v_now);
end $$;

create function private.get_board_snapshot_impl()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp(); v_items jsonb; v_next timestamptz;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'item_type',x.item_type,'quantity_value',x.quantity_value,'quantity_unit',x.quantity_unit,'berth',x.berth,'poster_label',x.poster_label,'created_at',x.created_at,'expires_at',x.expires_at) order by x.expires_at,x.created_at,x.id),'[]'::jsonb)
  into v_items from public.listings x where x.expires_at>v_now and x.stored_status<>'COLLECTED' and (x.stored_status='ACTIVE' or (x.stored_status='CLAIMED' and x.claim_expires_at<=v_now));
  select min(t.boundary) into v_next from (
    select l.expires_at boundary from public.listings l where l.expires_at>v_now and l.stored_status<>'COLLECTED' and (l.stored_status='ACTIVE' or (l.stored_status='CLAIMED' and l.claim_expires_at<=v_now))
    union all
    select l.claim_expires_at from public.listings l where l.stored_status='CLAIMED' and l.claim_expires_at>v_now and l.claim_expires_at<l.expires_at
  ) t;
  return jsonb_build_object('server_now',v_now,'next_transition_at',v_next,'items',v_items);
end $$;

create function private.get_owned_listing_impl(p_listing_id uuid,p_owner_token text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp(); v_listing public.listings; v_hash bytea;
begin
  select * into v_listing from public.listings where id=p_listing_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select owner_token_hash into v_hash from private.listing_capabilities where listing_id=p_listing_id;
  if v_hash is null or v_hash<>private.token_digest(p_owner_token) then raise exception 'CAPABILITY_INVALID'; end if;
  return jsonb_build_object('id',v_listing.id,'item_type',v_listing.item_type,'quantity_value',v_listing.quantity_value,'quantity_unit',v_listing.quantity_unit,'berth',v_listing.berth,'poster_label',v_listing.poster_label,'created_at',v_listing.created_at,'expires_at',v_listing.expires_at,'effective_status',private.effective_status(v_listing,v_now),'claimant_label',v_listing.claimant_label,'claimed_at',v_listing.claimed_at,'claim_expires_at',v_listing.claim_expires_at,'claim_version',v_listing.claim_version,'collected_at',v_listing.collected_at,'server_now',v_now);
end $$;

create function private.get_claim_receipt_impl(p_listing_id uuid,p_claim_version uuid,p_claim_token text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp(); v_listing public.listings; v_hash bytea;
begin
  select * into v_listing from public.listings where id=p_listing_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select claim_token_hash into v_hash from private.listing_capabilities where listing_id=p_listing_id;
  if v_listing.claim_version<>p_claim_version then raise exception 'STALE_CLAIM_VERSION'; end if;
  if v_hash is null or v_hash<>private.token_digest(p_claim_token) then raise exception 'CAPABILITY_INVALID'; end if;
  return jsonb_build_object('listing_id',v_listing.id,'item_type',v_listing.item_type,'quantity_value',v_listing.quantity_value,'quantity_unit',v_listing.quantity_unit,'berth',v_listing.berth,'claim_version',v_listing.claim_version,'claimed_at',v_listing.claimed_at,'claim_expires_at',v_listing.claim_expires_at,'expires_at',v_listing.expires_at,'effective_status',private.effective_status(v_listing,v_now),'server_now',v_now);
end $$;

-- Public API wrappers are invoker functions. Business mutations remain inside
-- private SECURITY DEFINER implementations and direct table writes stay closed.
create function public.create_listing(p_listing_id uuid,p_item_type public.item_type,p_quantity_value numeric,p_quantity_unit public.quantity_unit,p_berth text,p_poster_label text,p_spoil_minutes integer,p_owner_token text)
returns jsonb language sql security invoker set search_path='' as $$ select private.create_listing_impl(p_listing_id,p_item_type,p_quantity_value,p_quantity_unit,p_berth,p_poster_label,p_spoil_minutes,p_owner_token) $$;
create function public.claim_listing(p_listing_id uuid,p_claimant_label text,p_claim_version uuid,p_claim_token text)
returns jsonb language sql security invoker set search_path='' as $$ select private.claim_listing_impl(p_listing_id,p_claimant_label,p_claim_version,p_claim_token) $$;
create function public.release_claim(p_listing_id uuid,p_claim_version uuid,p_claim_token text)
returns jsonb language sql security invoker set search_path='' as $$ select private.release_claim_impl(p_listing_id,p_claim_version,p_claim_token) $$;
create function public.owner_release_claim(p_listing_id uuid,p_expected_claim_version uuid,p_owner_token text)
returns jsonb language sql security invoker set search_path='' as $$ select private.owner_release_claim_impl(p_listing_id,p_expected_claim_version,p_owner_token) $$;
create function public.confirm_collected(p_listing_id uuid,p_expected_claim_version uuid,p_owner_token text)
returns jsonb language sql security invoker set search_path='' as $$ select private.confirm_collected_impl(p_listing_id,p_expected_claim_version,p_owner_token) $$;
create function public.get_board_snapshot()
returns jsonb language sql stable security invoker set search_path='' as $$ select private.get_board_snapshot_impl() $$;
create function public.get_owned_listing(p_listing_id uuid,p_owner_token text)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.get_owned_listing_impl(p_listing_id,p_owner_token) $$;
create function public.get_claim_receipt(p_listing_id uuid,p_claim_version uuid,p_claim_token text)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.get_claim_receipt_impl(p_listing_id,p_claim_version,p_claim_token) $$;

revoke all on all functions in schema public from public, authenticated;
revoke all on all functions in schema private from public, authenticated;
grant usage on schema public, private to anon;
grant execute on function private.create_listing_impl(uuid,public.item_type,numeric,public.quantity_unit,text,text,integer,text) to anon;
grant execute on function private.claim_listing_impl(uuid,text,uuid,text) to anon;
grant execute on function private.release_claim_impl(uuid,uuid,text) to anon;
grant execute on function private.owner_release_claim_impl(uuid,uuid,text) to anon;
grant execute on function private.confirm_collected_impl(uuid,uuid,text) to anon;
grant execute on function private.get_board_snapshot_impl() to anon;
grant execute on function private.get_owned_listing_impl(uuid,text) to anon;
grant execute on function private.get_claim_receipt_impl(uuid,uuid,text) to anon;
grant execute on function public.create_listing(uuid,public.item_type,numeric,public.quantity_unit,text,text,integer,text) to anon;
grant execute on function public.claim_listing(uuid,text,uuid,text) to anon;
grant execute on function public.release_claim(uuid,uuid,text) to anon;
grant execute on function public.owner_release_claim(uuid,uuid,text) to anon;
grant execute on function public.confirm_collected(uuid,uuid,text) to anon;
grant execute on function public.get_board_snapshot() to anon;
grant execute on function public.get_owned_listing(uuid,text) to anon;
grant execute on function public.get_claim_receipt(uuid,uuid,text) to anon;

create function private.broadcast_board_changed()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform realtime.send(jsonb_build_object('kind','board_changed'),'board_changed','jettyshare:board',false);
  return null;
end $$;

create trigger jettyshare_board_changed
after insert or update or delete on public.listings
for each statement execute function private.broadcast_board_changed();
