"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import type { BubbleChartData, BubbleNode } from "@/lib/ai-agent";
import { formatCompact } from "@/lib/format";

const W = 560;
const H = 320;
const PAD = 14;

const METRIC_LABELS: Record<string, string> = {
  arr_flights: "抵达",
  arr_del15: "延误15+",
  arr_cancelled: "取消",
  arr_diverted: "备降",
  arr_delay: "延误分钟",
};

interface Placed {
  node: BubbleNode;
  x: number;
  y: number;
  r: number;
}

/** Deterministic flow layout (no physics) so the chart never jitters. */
function layout(nodes: BubbleNode[], max: number, level: number): Placed[] {
  const scale = level === 1 ? 1 : 0.72;
  const placed: Placed[] = [];
  let cursorX = PAD;
  let cursorY = PAD;
  let rowHeight = 0;

  for (const node of nodes) {
    const r = Math.max(12, Math.min(level === 1 ? 46 : 34, Math.sqrt(node.value / max) * 46 * scale));
    const step = r * 2 + 6;
    if (cursorX + step > W - PAD) {
      cursorX = PAD;
      cursorY += rowHeight + 6;
      rowHeight = 0;
    }
    placed.push({ node, x: cursorX + r, y: cursorY + r, r });
    cursorX += step;
    rowHeight = Math.max(rowHeight, r * 2);
  }
  return placed;
}

/**
 * Hierarchical bubble chart: airlines at level 1, their airports at level 2.
 * Click to drill in (zoom), use the back button to zoom out — the structure
 * mirrors the Dashboard bubble chart so the interaction feels familiar.
 */
export default function BubbleChartMessage({ payload }: { payload?: BubbleChartData | null }) {
  const [drilledId, setDrilledId] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const roots = payload?.nodes ?? [];
  if (!roots.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        （气泡图数据缺失）
      </Typography>
    );
  }

  const drilled = drilledId ? roots.find((node) => node.id === drilledId) ?? null : null;
  const nodes = drilled ? (drilled.children ?? []) : roots;
  const level = drilled ? 2 : 1;
  const max = Math.max(...nodes.map((node) => node.value), 1);
  const placed = layout(nodes, max, level);
  const active = hover !== null ? placed[hover] : null;

  return (
    <Box>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.6, mb: 0.8, alignItems: "center" }}>
        <Chip size="small" variant="outlined" label={`指标：${payload?.metricLabel ?? "-"}`} />
        <Chip size="small" variant="outlined" label={drilled ? `层级 2 · ${drilled.name}` : "层级 1 · 航司"} />
        {drilled && (
          <Button size="small" onClick={() => setDrilledId(null)} sx={{ minWidth: 0, px: 1 }}>
            ← 返回上一层
          </Button>
        )}
      </Box>

      <Box
        component="svg"
        viewBox={`0 0 ${W} ${H}`}
        sx={{ width: "100%", height: "auto", display: "block" }}
        role="img"
        aria-label="航司机场层级气泡图"
        onMouseLeave={() => setHover(null)}
      >
        {placed.map((item, index) => {
          const isActive = hover === index;
          const hasChildren = Boolean(item.node.children?.length);
          const fill = level === 1 ? "#2563eb" : "#38bdf8";
          return (
            <g
              key={item.node.id}
              onMouseEnter={() => setHover(index)}
              onClick={() => level === 1 && hasChildren && setDrilledId(item.node.id)}
              style={{ cursor: level === 1 && hasChildren ? "pointer" : "default" }}
            >
              <circle
                cx={item.x}
                cy={item.y}
                r={item.r}
                fill={fill}
                opacity={isActive ? 0.92 : 0.68}
                stroke={isActive ? "#0f172a" : "transparent"}
                strokeWidth={isActive ? 1.5 : 0}
              />
              {item.r >= 22 && (
                <text
                  x={item.x}
                  y={item.y + 3}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#fff"
                  pointerEvents="none"
                >
                  {item.node.name.length > 6 ? `${item.node.name.slice(0, 6)}…` : item.node.name}
                </text>
              )}
            </g>
          );
        })}

        {active && (
          <g pointerEvents="none">
            <rect
              x={Math.min(Math.max(active.x - 90, 4), W - 184)}
              y={Math.min(active.y + active.r + 6, H - 76)}
              width={180}
              height={70}
              rx={4}
              fill="#0f172a"
              opacity={0.92}
            />
            <text
              x={Math.min(Math.max(active.x - 90, 4), W - 184) + 10}
              y={Math.min(active.y + active.r + 6, H - 76) + 18}
              fontSize={11}
              fill="#fff"
            >
              {active.node.name}
            </text>
            <text
              x={Math.min(Math.max(active.x - 90, 4), W - 184) + 10}
              y={Math.min(active.y + active.r + 6, H - 76) + 34}
              fontSize={11}
              fill="#fff"
            >
              {`${payload?.metricLabel ?? "数值"}：${formatCompact(active.node.value).formatted}`}
            </text>
            <text
              x={Math.min(Math.max(active.x - 90, 4), W - 184) + 10}
              y={Math.min(active.y + active.r + 6, H - 76) + 50}
              fontSize={9}
              fill="#cbd5e1"
            >
              {Object.entries(active.node.metrics ?? {})
                .slice(0, 3)
                .map(([key, value]) => `${METRIC_LABELS[key] ?? key} ${formatCompact(value).formatted}`)
                .join(" · ") || (level === 1 ? "点击下钻查看机场" : "")}
            </text>
            <text
              x={Math.min(Math.max(active.x - 90, 4), W - 184) + 10}
              y={Math.min(active.y + active.r + 6, H - 76) + 64}
              fontSize={9}
              fill="#94a3b8"
            >
              {level === 1 && active.node.children?.length
                ? `含 ${active.node.children.length} 个机场 · 点击下钻`
                : ""}
            </text>
          </g>
        )}
      </Box>

      <Typography variant="caption" color="text.secondary">
        {level === 1
          ? `共 ${roots.length} 家航司，点击气泡可下钻到机场层级`
          : `${drilled?.name ?? ""}：${nodes.length} 个机场`}
      </Typography>
    </Box>
  );
}
