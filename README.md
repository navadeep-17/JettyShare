# JettyShare

Mobile-first coastal jetty board for sharing surplus crushed ice and live bait before they spoil.

## Status

Implementation in progress on `implementation-core`.

## Core flow

Post surplus → urgency-sorted live board → one-tap atomic claim → pickup / release / no-show recovery / collection.

## Stack

- Next.js + TypeScript
- Supabase PostgreSQL
- Vercel

## Local setup

Copy `.env.example` to `.env.local` and provide the JettyShare Supabase URL and publishable key.

```bash
npm install
npm run dev
```

## Security model

Crew names are unverified coordination labels. Per-listing owner and claim capabilities are generated in the browser and only their SHA-256 digests are stored server-side. Business mutations go through guarded PostgreSQL RPC functions.
