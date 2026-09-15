import { afterEach, describe, expect, it } from 'vitest'
import { activeSummaryItems, buildLastKnownSummary, buildShareSummary, canonicalBoardUrl } from './summary'
import type { BoardSnapshot } from './types'

const snapshot: BoardSnapshot = {
  server_now: '2026-09-15T12:00:00.000Z',
  next_transition_at: null,
  items: [
    {
      id: 'a', item_type: 'ICE', quantity_value: 25, quantity_unit: 'KG', berth: '08',
      poster_label: 'Provider Secret-ish Label', created_at: '2026-09-15T11:00:00.000Z', expires_at: '2026-09-15T12:08:59.000Z',
    },
    {
      id: 'b', item_type: 'BAIT', quantity_value: 3, quantity_unit: 'BUCKET', berth: '11',
      poster_label: 'Other Provider', created_at: '2026-09-15T11:05:00.000Z', expires_at: '2026-09-15T12:24:59.000Z',
    },
  ],
}

afterEach(() => { delete process.env.NEXT_PUBLIC_CANONICAL_APP_URL })

describe('copy summary', () => {
  it('preserves board order, omits poster labels, and rounds time down', () => {
    const text = buildShareSummary(snapshot, 'https://preview.example.test/path?x=1#hash', Date.parse(snapshot.server_now))
    expect(text).toContain('1. URGENT | ICE | 25 kg | Berth 08 | 8 min left')
    expect(text).toContain('2. BAIT | 3 buckets | Berth 11 | 24 min left')
    expect(text.indexOf('ICE')).toBeLessThan(text.indexOf('BAIT'))
    expect(text).not.toContain('Provider Secret-ish Label')
  })

  it('uses the stable configured canonical URL instead of a preview origin', () => {
    process.env.NEXT_PUBLIC_CANONICAL_APP_URL = 'https://jettyshare.example.test/subpath?ignored=1#ignored'
    expect(canonicalBoardUrl('https://preview.example.test')).toBe('https://jettyshare.example.test/')
  })

  it('prunes locally expired snapshot items at copy time', () => {
    const afterFirstExpires = Date.parse('2026-09-15T12:09:00.000Z')
    expect(activeSummaryItems(snapshot, afterFirstExpires).map((item) => item.id)).toEqual(['b'])
  })

  it('labels last-known information explicitly', () => {
    const text = buildLastKnownSummary(snapshot, 'https://jettyshare.example.test', Date.parse('2026-09-15T12:00:00Z'), Date.parse('2026-09-15T12:03:30Z'))
    expect(text).toContain('LAST KNOWN - JETTYSHARE SUPPLIES')
    expect(text).toContain('Last checked 3 min ago')
    expect(text).toContain('at last check')
    expect(text).toContain('may be outdated')
  })
})
