"use client";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import type { BarChartData } from "@/lib/ai-agent";
import { formatCompact, formatPercent } from "@/lib/format";

const W = 560;
const H = 220;
const PAD = { top: 16, right: 12, bottom: 34, left: 52 };
const MAX_BARS = 24;

/**
 * Multi-dimension bar chart for tool results.
 *
 * Same hand-rolled SVG approach as the Dashboard bar charts: hover a bar to see
 * its value *and* its share of the total. The dimension/metric chips echo the
 * filters the back end actually applied.
 */
export default function BarChartMessage({ payload }: { payload?: BarChartData | null }) {
  const [hover, setHover] = useState<number | null>(null);

  const points = payload?.points ?? [];
  if (!points.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        （图表数据缺失）
      </Typography>
    );
  }

  const shown = points.slice(0, MAX_BARS);
  const total = shown.reduce((sum, point) => sum + point.value, 0);
  const max = Math.max(...shown.map((point) => point.value), 1);

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / shown.length;
  const barWidth = Math.max(8, Math.min(40, band * 0.62));
  const active = hover !== null ? shown[hover] : null;

  return (
    <Box>
      {/* filter echo */}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.6, mb: 0.8 }}>
        <Chip size="small" variant="outlined" label={`维度：${payload?.dimensionLabel ?? "-"}`} />
        <Chip size="small" variant="outlined" label={`指标：${payload?.metricLabel ?? "-"}`} />
        <Chip size="small" variant="outlined" label={`${points.length} 个分组`} />
        {points.length > MAX_BARS && (
          <Chip size="small" color="warning" variant="outlined" label={`仅显示前 ${MAX_BARS} 项`} />
        )}
      </Box>

      <Box
        component="svg"
        viewBox={`0 0 ${W} ${H}`}
        sx={{ width: "100%", height: "auto", display: "block" }}
        role="img"
        aria-label={`${payload?.dimensionLabel ?? ""}维度${payload?.metricLabel ?? ""}条形图`}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 0.5, 1].map((ratio) => {
          const y = PAD.top + innerH - ratio * innerH;
          return (
            <g key={ratio}>
              <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="#eef2f7" />
              <text x={PAD.left - 8} y={y + 4} textAnchor="end" fontSize={10} fill="#64748b">
                {formatCompact(max * ratio).formatted}
              </text>
            </g>
          );
        })}

        {shown.map((point, index) => {
          const barH = (point.value / max) * innerH;
          const x = PAD.left + index * band + (band - barWidth) / 2;
          const y = PAD.top + innerH - barH;
          const isActive = hover === index;
          return (
            <g
              key={`${point.key}-${index}`}
              onMouseEnter={() => setHover(index)}
              style={{ cursor: "pointer" }}
            >
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barH}
                rx={2}
                fill={isActive ? "#1e40af" : "#1d4ed8"}
              />
              {/* invisible hit area keeps hover easy on short bars */}
              <rect x={x - (band - barWidth) / 2} y={PAD.top} width={band} height={innerH} fill="transparent" />
              <text
                x={x + barWidth / 2}
                y={H - 12}
                textAnchor="middle"
                fontSize={9}
                fill={isActive ? "#1e40af" : "#475569"}
              >
                {point.label.length > 6 ? `${point.label.slice(0, 6)}…` : point.label}
              </text>
            </g>
          );
        })}

        <line
          x1={PAD.left}
          y1={PAD.top + innerH}
          x2={W - PAD.right}
          y2={PAD.top + innerH}
          stroke="#cbd5e1"
        />

        {/* hover tooltip: value + share of total */}
        {active && hover !== null && (
          <g pointerEvents="none">
            <rect
              x={Math.min(Math.max(PAD.left, PAD.left + hover * band + band / 2 - 62), W - PAD.right - 124)}
              y={PAD.top - 4}
              width={124}
              height={44}
              rx={4}
              fill="#0f172a"
              opacity={0.92}
            />
            <text
              x={Math.min(Math.max(PAD.left + 8, PAD.left + hover * band + band / 2 - 54), W - PAD.right - 116)}
              y={PAD.top + 13}
              fontSize={10}
              fill="#fff"
            >
              {active.label}
            </text>
            <text
              x={Math.min(Math.max(PAD.left + 8, PAD.left + hover * band + band / 2 - 54), W - PAD.right - 116)}
              y={PAD.top + 30}
              fontSize={11}
              fill="#fff"
            >
              {`${formatCompact(active.value).formatted} · 占比 ${formatPercent(total ? active.value / total : null)}`}
            </text>
          </g>
        )}
      </Box>

      <Typography variant="caption" color="text.secondary">
        合计 {formatCompact(total).formatted}
        {payload?.metricLabel ? ` · ${payload.metricLabel}` : ""}
      </Typography>
    </Box>
  );
}
