import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function fail(message) {
  console.error(`SECURITY PREFLIGHT FAILED: ${message}`)
  process.exitCode = 1
}

function scanForPrivilegedMaterial(label, text) {
  const secretPrefix = ['sb', 'secret'].join('_') + '_'
  if (text.includes(secretPrefix)) fail(`${label} contains a Supabase secret-key prefix.`)

  const dbCredentialUrl = /postgres(?:ql)?:\/\/[^:\s/@]+:[^@\s/]+@/i
  if (dbCredentialUrl.test(text)) fail(`${label} contains a PostgreSQL URL with inline credentials.`)

  const privilegedAssignment = /SUPABASE_(?:SERVICE_ROLE|SECRET)_KEY\s*[:=]\s*["']?([^\s"']+)/gi
  for (const match of text.matchAll(privilegedAssignment)) {
    const value = match[1]
    const isTemplate = value.startsWith('${{') || value.startsWith('<') || /^(?:REDACTED|PLACEHOLDER|example|fake)/i.test(value)
    if (!isTemplate && value.length >= 20) fail(`${label} contains a populated privileged Supabase key assignment.`)
  }

  const jwtPattern = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g
  for (const token of text.match(jwtPattern) ?? []) {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
      if (payload?.role === 'service_role') fail(`${label} contains a legacy service_role JWT.`)
    } catch {
      // Non-JWT lookalikes are irrelevant to this targeted check.
    }
  }
}

const tracked = git(['ls-files']).trim().split('\n').filter(Boolean)
const forbiddenEnv = tracked.filter((path) => {
  const name = path.split('/').at(-1) ?? path
  return (name === '.env' || name.startsWith('.env.')) && name !== '.env.example'
})
if (forbiddenEnv.length) fail(`tracked environment file(s) found: ${forbiddenEnv.join(', ')}`)

const envExample = readFileSync('.env.example', 'utf8')
const allowedNames = new Set([
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_CANONICAL_APP_URL',
])
const fakeUrl = /^https:\/\/(?:your-project-ref|example)\.supabase\.co$/
const fakeKey = /^(?:your-publishable-key|sb_publishable_(?:example|test)[A-Za-z0-9_-]*)$/

for (const rawLine of envExample.split(/\r?\n/)) {
  const line = rawLine.trim()
  if (!line || line.startsWith('#')) continue
  const index = line.indexOf('=')
  if (index < 1) {
    fail(`.env.example has a malformed line: ${line}`)
    continue
  }
  const name = line.slice(0, index)
  const value = line.slice(index + 1)
  if (!allowedNames.has(name)) fail(`.env.example contains unexpected variable ${name}.`)

  if (name === 'NEXT_PUBLIC_SUPABASE_URL' && value && !fakeUrl.test(value)) {
    fail('.env.example Supabase URL must be empty or an unmistakable fake placeholder.')
  }
  if (name === 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY' && value && !fakeKey.test(value)) {
    fail('.env.example publishable key must be empty or an unmistakable fake placeholder.')
  }
  if (name === 'NEXT_PUBLIC_CANONICAL_APP_URL' && value && !/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/?$/.test(value)) {
    fail('.env.example canonical URL must be empty or local-only.')
  }
}
for (const name of allowedNames) {
  if (!envExample.split(/\r?\n/).some((line) => line.startsWith(`${name}=`))) fail(`.env.example is missing ${name}.`)
}

const trackedText = tracked
  .filter((path) => !path.endsWith('package-lock.json') && path !== 'scripts/security-preflight.mjs')
  .map((path) => {
    try { return `\n--- ${path} ---\n${readFileSync(path, 'utf8')}` } catch { return '' }
  })
  .join('')
scanForPrivilegedMaterial('tracked files', trackedText)

if (/dangerouslySetInnerHTML/.test(trackedText)) fail('tracked source uses dangerouslySetInnerHTML.')
if (/(?:@vercel\/analytics|posthog|mixpanel|segment\.com|hotjar|fullstory)/i.test(trackedText)) {
  fail('tracked files reference an analytics/session-replay integration.')
}

const shallow = git(['rev-parse', '--is-shallow-repository']).trim() === 'true'
if (shallow) {
  console.warn('SECURITY PREFLIGHT WARNING: repository is shallow; full-history secret scan requires a full checkout.')
} else {
  const history = git([
    'log', '-p', '--all', '--full-history', '--no-ext-diff', '--', '.',
    ':(exclude)package-lock.json',
    ':(exclude)scripts/security-preflight.mjs',
  ])
  scanForPrivilegedMaterial('Git history', history)
}

if (!process.exitCode) console.log('Security preflight passed: env hygiene, privileged-key patterns, browser-XSS/analytics guard, and available Git history are clean.')
