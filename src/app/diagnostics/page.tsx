import { notFound } from 'next/navigation'

function safeHost(value?: string) {
  if (!value) return 'NOT CONFIGURED'
  try { return new URL(value).host } catch { return 'INVALID URL' }
}

export default function DiagnosticsPage() {
  const vercelEnv = process.env.VERCEL_ENV ?? 'local'
  if (vercelEnv === 'production') notFound()

  const supabaseHost = safeHost(process.env.NEXT_PUBLIC_SUPABASE_URL)
  const canonicalHost = safeHost(process.env.NEXT_PUBLIC_CANONICAL_APP_URL)
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA ?? 'UNKNOWN'

  return (
    <main className="diagnostics-page">
      <p className="eyebrow">NON-PRODUCTION DIAGNOSTICS</p>
      <h1>JettyShare environment</h1>
      <p>This page intentionally shows hosts and deployment identity only. It never renders API key contents.</p>
      <dl className="diagnostics-grid">
        <div><dt>Runtime</dt><dd>{vercelEnv}</dd></div>
        <div><dt>Supabase host</dt><dd>{supabaseHost}</dd></div>
        <div><dt>Canonical host</dt><dd>{canonicalHost}</dd></div>
        <div><dt>Commit SHA</dt><dd>{commitSha}</dd></div>
      </dl>
    </main>
  )
}
