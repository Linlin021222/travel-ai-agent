"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import { useEffect, useMemo, useRef, useState } from "react";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import {
  CHART_DIMENSIONS,
  CHART_DIMENSION_LABELS,
  CHART_METRIC_LABELS,
  formatMetric,
  type AggregatePoint,
  type ChartDimension,
  type DashboardFilters,
} from "@/lib/flight-delay";
import { getAggregate } from "@/lib/api";
import { toChartQuery } from "@/lib/flight-delay";
import { useElementWidth } from "@/lib/useElementWidth";

interface BarChartCardProps {
  title?: string;
  dimension: ChartDimension;
  onDimensionChange: (dimension: ChartDimension) => void;
  filters: DashboardFilters;
}

const AIRPORT_CAP = 50;
const WINDOW_SIZE = 12; // max items visible in sliding window (for date dimension)
const MARGIN = { top: 16, right: 16, bottom: 56, left: 64 };
const HEIGHT = 340;

export default function BarChartCard({
  title,
  dimension,
  onDimensionChange,
  filters,
}: BarChartCardProps) {
  const [data, setData] = useState<AggregatePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<{ point: AggregatePoint; x: number; y: number } | null>(null);
  const [windowStart, setWindowStart] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const width = useElementWidth(containerRef, 720);

  const query = useMemo(() => toChartQuery(filters), [filters]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAggregate({ ...query, dimension, metric: filters.metric })
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dimension, filters.metric, query]);

  // Cap airport dimension to keep the chart readable.
  const displayData = useMemo(() => {
    if (dimension === "airport" && data.length > AIRPORT_CAP) {
      return data.slice(0, AIRPORT_CAP);
    }
    return data;
  }, [dimension, data]);

  // Sliding window: only for date dimension when there are many items.
  const needsWindow = dimension === "date" && displayData.length > WINDOW_SIZE;
  // Reset window start when data changes (new fetch / filter change).
  useEffect(() => { setWindowStart(0); setShowAll(false); }, [displayData]);
  const windowEnd = Math.min(windowStart + WINDOW_SIZE, displayData.length);
  const windowedData = (needsWindow && !showAll) ? displayData.slice(windowStart, windowEnd) : displayData;
  const canGoPrev = windowStart > 0;
  const canGoNext = windowEnd < displayData.length;

  const metricLabel = CHART_METRIC_LABELS[filters.metric];
  const innerW = Math.max(120, width - MARGIN.left - MARGIN.right);
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const maxValue = windowedData.reduce((max, point) => Math.max(max, point.value), 0);
  const yTicks = useMemo(() => buildTicks(maxValue), [maxValue]);

  const barCount = windowedData.length;
  const bandwidth = barCount > 0 ? innerW / barCount : innerW;
  const barWidth = Math.max(1, Math.min(48, bandwidth * 0.7));

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {title ?? "动态条形图"}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {metricLabel} · 按{CHART_DIMENSION_LABELS[dimension]}
          </Typography>
        </Box>
        <Tabs
          value={dimension}
          onChange={(_, value: ChartDimension) => onDimensionChange(value)}
          sx={{ minHeight: 32 }}
        >
          {CHART_DIMENSIONS.map((dim) => (
            <Tab key={dim} value={dim} label={CHART_DIMENSION_LABELS[dim]} sx={{ minHeight: 32, py: 0 }} />
          ))}
        </Tabs>
      </Box>

      <Box ref={containerRef} sx={{ position: "relative", width: "100%" }}>
        {loading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress size={28} />
          </Box>
        )}
        {!loading && error && (
          <Typography color="error" sx={{ py: 6, textAlign: "center" }}>
            {error}
          </Typography>
        )}
        {!loading && !error && windowedData.length === 0 && (
          <Box
            sx={{
              py: 8,
              textAlign: "center",
              color: "text.secondary",
              border: "1px dashed",
              borderColor: "divider",
              borderRadius: 2,
            }}
          >
            <Typography>当前筛选条件下没有匹配的数据</Typography>
            <Typography variant="caption">请调整日期范围、航空公司或机场筛选</Typography>
          </Box>
        )}
        {!loading && !error && windowedData.length > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`${metricLabel} 按${CHART_DIMENSION_LABELS[dimension]}分布`}
            onMouseLeave={() => setHovered(null)}
          >
            {/* y grid + labels */}
            {yTicks.map((tick) => {
              const y = MARGIN.top + innerH - (tick / maxValue) * innerH;
              return (
                <g key={tick}>
                  <line x1={MARGIN.left} y1={y} x2={width - MARGIN.right} y2={y} stroke="#eef2f7" />
                  <text x={MARGIN.left - 8} y={y + 4} textAnchor="end" fontSize={11} fill="#64748b">
                    {formatMetric(tick)}
                  </text>
                </g>
              );
            })}

            {/* bars */}
            {windowedData.map((point, index) => {
              const x = MARGIN.left + index * bandwidth + (bandwidth - barWidth) / 2;
              const barH = maxValue > 0 ? (point.value / maxValue) * innerH : 0;
              const y = MARGIN.top + innerH - barH;
              const isActive = hovered?.point.key === point.key;
              return (
                <g key={point.key}>
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={barH}
                    rx={2}
                    fill={isActive ? "#1e40af" : "#1d4ed8"}
                    onMouseEnter={(e) =>
                      setHovered({ point, x: e.clientX, y: e.clientY })
                    }
                  />
                  {/* x label (rotated for date) */}
                  <text
                    x={x + barWidth / 2}
                    y={HEIGHT - MARGIN.bottom + 14}
                    textAnchor="end"
                    fontSize={10}
                    fill="#475569"
                    transform={
                      dimension === "date"
                        ? `rotate(-45 ${x + barWidth / 2} ${HEIGHT - MARGIN.bottom + 14})`
                        : undefined
                    }
                  >
                    {dimension === "date" ? point.label.slice(2) : point.key}
                  </text>
                </g>
              );
            })}

            {/* axis line */}
            <line
              x1={MARGIN.left}
              y1={MARGIN.top + innerH}
              x2={width - MARGIN.right}
              y2={MARGIN.top + innerH}
              stroke="#cbd5e1"
            />
          </svg>
        )}

        {hovered && (
          <Box
            sx={{
              position: "fixed",
              left: hovered.x + 12,
              top: hovered.y + 12,
              pointerEvents: "none",
              zIndex: 1300,
              bgcolor: "rgba(15,23,42,0.92)",
              color: "#fff",
              px: 1.25,
              py: 0.75,
              borderRadius: 1,
              fontSize: 12,
              boxShadow: 3,
            }}
          >
            <div style={{ fontWeight: 700 }}>{hovered.point.label}</div>
            <div>
              {metricLabel}：{formatMetric(hovered.point.value)}
            </div>
          </Box>
        )}
      </Box>

      {needsWindow && (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, mt: 1 }}>
          <Button
            size="small"
            disabled={!canGoPrev}
            onClick={() => setWindowStart((s) => Math.max(0, s - WINDOW_SIZE))}
            startIcon={<ChevronLeftIcon />}
          >
            前一页
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 160, textAlign: "center" }}>
            {showAll
              ? `共 ${displayData.length} 项（全部展示）`
              : `第 ${windowStart + 1} ~ ${windowEnd} / 共 ${displayData.length} 项`}
          </Typography>
          <Button
            size="small"
            disabled={!canGoNext}
            onClick={() => setWindowStart((s) => Math.min(displayData.length - WINDOW_SIZE, s + WINDOW_SIZE))}
            endIcon={<ChevronRightIcon />}
          >
            后一页
          </Button>
          <Button
            size="small"
            variant={showAll ? "contained" : "outlined"}
            onClick={() => setShowAll((v) => !v)}
            sx={{ ml: 1 }}
          >
            {showAll ? "窗口模式" : "展示全部"}
          </Button>
        </Box>
      )}

      {dimension === "airport" && data.length > AIRPORT_CAP && (
        <Typography variant="caption" color="text.secondary">
          机场数量较多，仅展示数值最高的前 {AIRPORT_CAP} 个（共 {data.length} 个）。
        </Typography>
      )}
    </Paper>
  );
}

function buildTicks(max: number): number[] {
  if (max <= 0) return [0];
  const step = niceStep(max / 4);
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] !== max) ticks.push(max);
  return ticks;
}

function niceStep(raw: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return Math.max(1, step * mag);
}
