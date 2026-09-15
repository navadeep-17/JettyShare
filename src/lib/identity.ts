export function normalizeCrewLabel(value: string): string {
  if(/[\u0000-\u001F\u007F]/.test(value)) throw new Error('CONTROL_CHARACTER')
  return value.trim().replace(/\s+/g, ' ')
}

export function validateCrewLabel(value: string): string {
  const normalized = normalizeCrewLabel(value)
  if (normalized.length < 1 || normalized.length > 40) throw new Error('LENGTH')
  return normalized
}
