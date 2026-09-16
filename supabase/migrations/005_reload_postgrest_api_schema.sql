-- JettyShare Component 09 hardening follow-up.
-- Migration 004 changes both db-schemas and the callable routine surface.
-- Reload both PostgREST configuration and its schema cache so only api remains
-- selectable immediately after promotion.

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
