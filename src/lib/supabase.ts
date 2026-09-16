import { createClient } from '@supabase/supabase-js'

function requiredPublicEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required. Configure Development/Preview/Production explicitly; JettyShare must never silently fall back to PROD.`)
  }
  return value
}

const supabaseUrl = requiredPublicEnv('NEXT_PUBLIC_SUPABASE_URL')
const supabasePublishableKey = requiredPublicEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
