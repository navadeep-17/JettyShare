import { describe, expect, it } from 'vitest'
import { boardCountdown, copyRemaining, serverClockOffset } from './time'

describe('time presentation', () => {
  const now = Date.parse('2026-09-15T12:00:00.000Z')

  it('uses the server clock reference instead of trusting the device clock', () => {
    expect(serverClockOffset('2026-09-15T12:00:05.000Z', now)).toBe(5000)
  })

  it('uses frozen urgency bands and m:ss below ten minutes', () => {
    expect(boardCountdown('2026-09-15T12:08:09.000Z', now)).toEqual({
      expired: false,
      band: 'URGENT',
      text: '8m 09s left',
    })
    expect(boardCountdown('2026-09-15T12:20:00.000Z', now).band).toBe('SOON')
    expect(boardCountdown('2026-09-15T12:45:00.000Z', now).band).toBe('AVAILABLE')
  })

  it('never rounds copied time upward', () => {
    expect(copyRemaining(59_999)).toBe('under 1 min left')
    expect(copyRemaining(8 * 60_000 + 59_000)).toBe('8 min left')
    expect(copyRemaining(65 * 60_000 + 59_000)).toBe('1h 05m left')
  })
})
