import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const globals = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8')
const hardening = readFileSync(fileURLToPath(new URL('../app/component08.css', import.meta.url)), 'utf8')

describe('Component 08 frozen CSS contract', () => {
  it('keeps the exact high-glare semantic palette and intentional light color scheme', () => {
    for (const token of [
      'color-scheme:light',
      '--ink:#123B4A',
      '--ink-strong:#0B2430',
      '--interactive:#0A7E83',
      '--canvas:#F8FAFC',
      '--surface:#FFFFFF',
      '--border:#64748B',
      '--urgent-bg:#FFF4D6',
      '--urgent-text:#7A3E00',
      '--success-bg:#EAF7EE',
      '--success-text:#166534',
      '--danger-bg:#FBEAEA',
      '--danger-text:#8B1E1E',
      '--info-bg:#EFF4FB',
      '--info-text:#0B5660',
    ]) expect(globals).toContain(token)
    expect(globals).not.toMatch(/@media\s*\(prefers-color-scheme\s*:\s*dark/i)
  })

  it('locks touch targets, focus ring, content/dialog widths and safe-area-aware sheet actions', () => {
    expect(globals).toContain('.button{min-height:48px')
    expect(globals).toContain('.compact{min-height:44px')
    expect(globals).toContain('.app-shell{width:min(100%,720px)')
    expect(globals).toContain('.sheet{background:var(--surface);width:min(100%,520px);max-height:92dvh')
    expect(globals).toContain('padding:24px 20px calc(24px + env(safe-area-inset-bottom))')
    expect(globals).toContain('bottom:calc(16px + env(safe-area-inset-bottom))')
    expect(globals).toContain('outline:3px solid var(--interactive);outline-offset:2px')
  })

  it('keeps the design media-light and reduced-motion-safe', () => {
    expect(globals).not.toMatch(/@font-face/i)
    expect(globals).toContain('@media(prefers-reduced-motion:reduce)')
    expect(globals).not.toMatch(/url\([^)]*\.(?:woff2?|ttf|otf|png|jpe?g|webp)/i)
  })

  it('separates destructive actions and protects operational layout from long secondary identity text', () => {
    expect(hardening).toMatch(/\.action-grid,\s*\.receipt-actions\s*\{\s*gap:\s*12px;/)
    expect(hardening).toMatch(/\.posted-by,\s*\.profile-panel strong\s*\{[^}]*overflow-wrap:\s*anywhere;/s)
    expect(hardening).toMatch(/\.copy-stale-actions\s*\{[^}]*gap:\s*12px;/s)
  })
})
