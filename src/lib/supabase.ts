import { createClient } from '@supabase/supabase-js'

// Next.js only inlines NEXT_PUBLIC_* values into browser bundles when the
// environment access is statically analyzable. Keep these direct references;
// dynamic process.env[name] access becomes undefined in the client bundle.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL is required. Configure Development/Preview/Production explicitly; JettyShare must never silently fall back to PROD.')
}

if (!supabasePublishableKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required. Configure Development/Preview/Production explicitly; JettyShare must never silently fall back to PROD.')
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
