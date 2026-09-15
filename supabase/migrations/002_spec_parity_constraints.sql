-- JettyShare v1 hardening: align persisted fields with Components 01/02.
-- Safe for the existing production rows: preflight confirmed values fit these constraints.

alter table public.listings
  alter column quantity_value type numeric(8,2) using quantity_value::numeric(8,2);

alter table public.listings
  add constraint listings_poster_label_normalized_chk
  check (
    poster_label = btrim(poster_label)
    and poster_label !~ '[[:cntrl:]]'
    and poster_label !~ ' {2,}'
  );

alter table public.listings
  add constraint listings_claimant_label_normalized_chk
  check (
    claimant_label is null
    or (
      claimant_label = btrim(claimant_label)
      and claimant_label !~ '[[:cntrl:]]'
      and claimant_label !~ ' {2,}'
    )
  );
