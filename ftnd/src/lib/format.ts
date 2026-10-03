/**
 * Big-number formatting shared by the Dashboard cards and the AI metric cards.
 * Mirrors `bknd/src/ai-agent/tools/number-format.ts` so both sides agree.
 */
export interface CompactNumber {
  formatted: string;
  unit: string | null;
}

const UNITS: Array<{ threshold: number; unit: string }> = [
  { threshold: 1_000_000_000, unit: "B" },
  { threshold: 1_000_000, unit: "M" },
  { threshold: 1_000, unit: "K" },
];

function trimZeros(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

export function formatCompact(value: number | null | undefined): CompactNumber {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { formatted: "-", unit: null };
  }
  const abs = Math.abs(value);
  for (const { threshold, unit } of UNITS) {
    if (abs >= threshold) {
      const scaled = value / threshold;
      const digits = Math.abs(scaled) >= 100 ? 1 : 2;
      return { formatted: `${trimZeros(scaled, digits)}${unit}`, unit };
    }
  }
  return { formatted: trimZeros(value, 0), unit: null };
}

/** `0.0123` -> `1.23%` */
export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `${trimZeros(value * 100, digits)}%`;
}

export function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return Math.round(value).toLocaleString("zh-CN");
}
