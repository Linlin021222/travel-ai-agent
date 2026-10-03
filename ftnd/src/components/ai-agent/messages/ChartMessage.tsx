"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ChartPayload } from "@/lib/ai-agent";

const CHART_W = 420;
const CHART_H = 180;
const PAD = { top: 12, right: 8, bottom: 26, left: 40 };

/**
 * Lightweight in-chat bar chart. Kept dependency-free (hand-rolled SVG) to
 * match the dashboard's bar charts without pulling a chart library in.
 */
export default function ChartMessage({ payload }: { payload?: ChartPayload | null }) {
  const series = payload?.series ?? [];

  if (!series.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        （图表数据缺失）
      </Typography>
    );
  }

  const innerW = CHART_W - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;
  const max = Math.max(...series.map((point) => point.value), 1);
  const band = innerW / series.length;
  const barWidth = Math.max(6, Math.min(36, band * 0.62));

  return (
    <Box>
      {payload?.title && (
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.6 }}>
          {payload.title}
        </Typography>
      )}
      <Box
        component="svg"
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        sx={{ width: "100%", height: "auto", display: "block" }}
        role="img"
        aria-label={payload?.title ?? "图表"}
      >
        {/* horizontal grid + y labels */}
        {[0, 0.5, 1].map((ratio) => {
          const y = PAD.top + innerH - ratio * innerH;
          return (
            <g key={ratio}>
              <line x1={PAD.left} y1={y} x2={CHART_W - PAD.right} y2={y} stroke="#eef2f7" />
              <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize={10} fill="#64748b">
                {Math.round(max * ratio)}
              </text>
            </g>
          );
        })}

        {/* bars */}
        {series.map((point, index) => {
          const barH = (point.value / max) * innerH;
          const x = PAD.left + index * band + (band - barWidth) / 2;
          const y = PAD.top + innerH - barH;
          return (
            <g key={point.label}>
              <rect x={x} y={y} width={barWidth} height={barH} rx={2} fill="#1d4ed8" />
              <text
                x={x + barWidth / 2}
                y={CHART_H - 8}
                textAnchor="middle"
                fontSize={10}
                fill="#475569"
              >
                {point.label}
              </text>
            </g>
          );
        })}

        {/* axis */}
        <line
          x1={PAD.left}
          y1={PAD.top + innerH}
          x2={CHART_W - PAD.right}
          y2={PAD.top + innerH}
          stroke="#cbd5e1"
        />
      </Box>
      {(payload?.xLabel || payload?.yLabel) && (
        <Typography variant="caption" color="text.secondary">
          {payload.xLabel ? `X：${payload.xLabel}` : ""}
          {payload.xLabel && payload.yLabel ? "　" : ""}
          {payload.yLabel ? `Y：${payload.yLabel}` : ""}
        </Typography>
      )}
    </Box>
  );
}
