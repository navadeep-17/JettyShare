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
    expect(text).not.toContain('Other Provider')
  })

  it('uses the stable configured canonical URL instead of a preview origin and strips path/query/hash', () => {
    process.env.NEXT_PUBLIC_CANONICAL_APP_URL = 'https://jettyshare.example.test/subpath?ignored=1#ignored'
    expect(canonicalBoardUrl('https://preview.example.test/path?x=1#hash')).toBe('https://jettyshare.example.test/')
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

  it('uses conservative boundary wording below one minute and hour-minute formatting at 65 minutes', () => {
    const now = Date.parse('2026-09-15T12:00:00.000Z')
    const boundary: BoardSnapshot = {
      server_now: new Date(now).toISOString(),
      next_transition_at: null,
      items: [
        {
          id: 'under-minute', item_type: 'ICE', quantity_value: 1, quantity_unit: 'BOX', berth: '01', poster_label: 'Hidden',
          created_at: new Date(now - 1000).toISOString(), expires_at: new Date(now + 59_999).toISOString(),
        },
        {
          id: 'hour', item_type: 'BAIT', quantity_value: 1, quantity_unit: 'TRAY', berth: '02', poster_label: 'Hidden',
          created_at: new Date(now - 1000).toISOString(), expires_at: new Date(now + 65 * 60_000).toISOString(),
        },
      ],
    }
    const text = buildShareSummary(boundary, 'https://jettyshare.example.test', now)
    expect(text).toContain('1. URGENT | ICE | 1 box | Berth 01 | under 1 min left')
    expect(text).toContain('2. BAIT | 1 tray | Berth 02 | 1h 05m left')
  })

  it('formats a 30-row board immediately, omits unusual poster content, and remains deterministic byte-for-byte', () => {
    const now = Date.parse('2026-09-15T12:00:00.000Z')
    const items: BoardSnapshot['items'] = Array.from({ length: 30 }, (_, index) => ({
      id: `row-${index}`,
      item_type: index % 2 === 0 ? 'ICE' as const : 'BAIT' as const,
      quantity_value: index + 1,
      quantity_unit: index % 2 === 0 ? 'KG' as const : 'BUCKET' as const,
      berth: String(index + 1).padStart(2, '0'),
      poster_label: index === 0 ? '"<script>alert(1)</script>\nUNUSUAL PROVIDER' : `Provider ${index}`,
      created_at: new Date(now - 60_000).toISOString(),
      expires_at: new Date(now + (20 + index) * 60_000).toISOString(),
    }))
    const bulk: BoardSnapshot = { server_now: new Date(now).toISOString(), next_transition_at: null, items }

    const first = buildShareSummary(bulk, 'https://jettyshare.example.test', now)
    const second = buildShareSummary(bulk, 'https://jettyshare.example.test', now)
    expect(first).toBe(second)
    expect(first).toContain('30. BAIT | 30 buckets | Berth 30 | 49 min left')
    expect(first).not.toContain('script')
    expect(first).not.toContain('UNUSUAL PROVIDER')
    expect(first.split('\n').filter((line) => /^\d+\./.test(line))).toHaveLength(30)
  })
})
