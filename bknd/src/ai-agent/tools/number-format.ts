/**
 * Compact "big number" formatting (K / M / B).
 *
 * The back end owns this rule so the Dashboard cards and the AI metric cards
 * can never drift apart: both render exactly the same string.
 */
export interface CompactNumber {
  /** e.g. `3.9M` */
  formatted: string;
  /** `K` | `M` | `B` | null (null = value shown as-is) */
  unit: string | null;
}

const UNITS: Array<{ threshold: number; unit: string }> = [
  { threshold: 1_000_000_000, unit: 'B' },
  { threshold: 1_000_000, unit: 'M' },
  { threshold: 1_000, unit: 'K' },
];

function trimZeros(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

export function formatCompact(value: number | null | undefined): CompactNumber {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { formatted: '-', unit: null };
  }

  const abs = Math.abs(value);
  for (const { threshold, unit } of UNITS) {
    if (abs >= threshold) {
      const scaled = value / threshold;
      // Larger magnitudes need less precision; keep 1 decimal above 100 units.
      const digits = Math.abs(scaled) >= 100 ? 1 : 2;
      return { formatted: `${trimZeros(scaled, digits)}${unit}`, unit };
    }
  }

  return { formatted: trimZeros(value, 0), unit: null };
}

/** Ratio helper: returns `null` when the denominator is zero. */
export function ratio(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}
