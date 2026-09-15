import { createClient } from '@supabase/supabase-js'

// Both values below are public browser configuration, not secrets. Vercel/env
// variables override them when configured; the fallback keeps the published
// prototype deployable without a server-side secret-management dependency.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://bxqumvatvqhvqdngrklk.supabase.co'
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_vC9nM3a4NDY4Hd9x-BQosg_VxERTrUP'

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
