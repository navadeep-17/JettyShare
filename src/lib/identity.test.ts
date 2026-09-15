import { describe, expect, it } from 'vitest'
import { normalizeCrewLabel, validateCrewLabel } from './identity'

describe('crew label normalization', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normalizeCrewLabel('  Sea   Queen\tCrew  ')).toBe('Sea Queen Crew')
  })

  it('rejects control characters', () => {
    expect(() => normalizeCrewLabel('Boat\u0007Name')).toThrow('CONTROL_CHARACTER')
  })

  it('enforces the frozen 1-40 character boundary', () => {
    expect(validateCrewLabel('A')).toBe('A')
    expect(() => validateCrewLabel('')).toThrow('LENGTH')
    expect(() => validateCrewLabel('x'.repeat(41))).toThrow('LENGTH')
  })
})
