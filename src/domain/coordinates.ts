/**
 * Parses an AEMET "ddmmss + hemisphere" coordinate string (e.g. "394924N",
 * "134125W") into signed decimal degrees. Returns null when the value does
 * not match the expected shape or cannot be interpreted.
 */
export function parseDmsToDecimal(value: string): number | null {
  const match = /^(\d{2,3})(\d{2})(\d{2})([NSEW])$/.exec(value.trim().toUpperCase());
  if (!match) {
    return null;
  }
  const degrees = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const decimal = degrees + minutes / 60 + seconds / 3600;
  if (!Number.isFinite(decimal)) {
    return null;
  }
  return match[4] === 'S' || match[4] === 'W' ? -decimal : decimal;
}
