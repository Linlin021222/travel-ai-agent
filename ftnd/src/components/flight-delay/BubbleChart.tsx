"use client";

import * as d3 from "d3";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatMetric, type BubblePoint } from "@/lib/flight-delay";

interface Metrics {
  arr_flights: number;
  arr_del15: number;
  arr_cancelled: number;
  arr_diverted: number;
  arr_delay: number;
}

interface BubbleNode {
  id: string;           // carrier_code or "carrier_code:airport_code"
  label: string;        // display name
  carrierName?: string; // full name (airlines only)
  value: number;         // arr_flights (drives size)
  metrics: Metrics;
  radius: number;        // computed radius
  carrierCode: string;   // parent carrier (for coloring)
  isAirline: boolean;    // true = level 1 (airline), false = level 2 (airport)
  x?: number;            // set by force simulation
  y?: number;
}

const W = 860;  // inner width
const H = 520;  // inner height
const PADDING = 12; // min gap between bubble edges

export default function BubbleChart({
  data,
  loading: loadingProp,
}: {
  data: BubblePoint[];
  loading?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; title: string; lines: string[] } | null>(null);
  // Focus: null = root (airlines), or a carrier_code (its airports).
  const [focusCarrier, setFocusCarrier] = useState<string | null>(null);

  // ---- Build node list from raw data ----
  const { airlines, airportsByCarrier } = useMemo(() => {
    if (!data.length) return { airlines: [] as BubbleNode[], airportsByCarrier: {} as Record<string, BubbleNode[]> };

    const byCarrier = d3.group(data, (d) => d.carrier_code);
    const airlineMap = new Map<string, BubbleNode>();
    const airportMap: Record<string, BubbleNode[]> = {};

    for (const [code, rows] of byCarrier) {
      const carrier_name = rows[0].carrier_name;
      let totalFlights = 0;
      const acc: Metrics = { arr_flights: 0, arr_del15: 0, arr_cancelled: 0, arr_diverted: 0, arr_delay: 0 };
      const airports: BubbleNode[] = [];

      for (const r of rows) {
        totalFlights += r.arr_flights;
        acc.arr_flights += r.arr_flights;
        acc.arr_del15 += r.arr_del15;
        acc.arr_cancelled += r.arr_cancelled;
        acc.arr_diverted += r.arr_diverted;
        acc.arr_delay += r.arr_delay;

        airports.push({
          id: `${code}:${r.airport_code}`,
          label: r.airport_code,
          value: r.arr_flights,
          metrics: { arr_flights: r.arr_flights, arr_del15: r.arr_del15, arr_cancelled: r.arr_cancelled, arr_diverted: r.arr_diverted, arr_delay: r.arr_delay },
          radius: 0, // computed below
          carrierCode: code,
          isAirline: false,
        });
      }

      airlineMap.set(code, {
        id: code,
        label: code,
        carrierName: carrier_name,
        value: totalFlights,
        metrics: acc,
        radius: 0,
        carrierCode: code,
        isAirline: true,
      });
      airportMap[code] = airports;
    }

    return {
      airlines: Array.from(airlineMap.values()),
      airportsByCarrier: airportMap as Record<string, BubbleNode[]>,
    };
  }, [data]);

  // Current nodes to display (airlines or one carrier's airports).
  const nodes = useMemo<BubbleNode[]>(() => {
    if (!airlines.length) return [];
    if (focusCarrier) return airportsByCarrier[focusCarrier] ?? [];
    return airlines;
  }, [airlines, airportsByCarrier, focusCarrier]);

  // Deterministic hue per carrier.
  const hueMap = useMemo(() => {
    const map = new Map<string, number>();
    const codes = airlines.map((a) => a.carrierCode);
    codes.forEach((c, i) => map.set(c, Math.round((i * 360) / Math.max(1, codes.length))));
    return map;
  }, [airlines]);

  // ---- Force simulation layout ----
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    if (!nodes.length) {
      setEmpty(true);
      setLoading(Boolean(loadingProp));
      return;
    }
    setEmpty(false);
    setLoading(false);
    setCanGoBack(focusCarrier !== null);

    // Compute radii: area proportional to value, with reasonable bounds.
    const maxVal = Math.max(...nodes.map((n) => n.value), 1);
    const maxR = Math.min(W, H) * 0.18;
    const minR = 14;
    for (const n of nodes) {
      n.radius = Math.max(minR, maxR * Math.sqrt(n.value / maxVal));
    }

    // Clear previous.
    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${W} ${H}`);

    // Initialize positions in a grid so simulation starts stable.
    const cols = Math.ceil(Math.sqrt(nodes.length));
    const cellW = W / (cols + 1);
    const cellH = H / (Math.ceil(nodes.length / cols) + 1);
    nodes.forEach((n, i) => {
      n.x = cellW * ((i % cols) + 1);
      n.y = cellH * (Math.floor(i / cols) + 1);
    });

    // Create SVG groups for each node.
    const g = svg.append("g");
    const nodeSel = g
      .selectAll<SVGGElement, BubbleNode>("g")
      .data(nodes)
      .join("g")
      .attr("class", "bubble-node");

    nodeSel
      .append("circle")
      .attr("r", (d) => d.radius)
      .attr("fill", (d) => fillFor(d))
      .attr("fill-opacity", (d) => (d.isAirline ? 0.55 : 0.85))
      .attr("stroke", (d) => strokeFor(d))
      .attr("stroke-width", 1)
      .style("cursor", "pointer");

    nodeSel
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.32em")
      .attr("font-size", (d) => Math.max(9, Math.min(16, d.radius / 2.2)))
      .attr("font-weight", (d) => (d.isAirline ? 700 : 500))
      .attr("fill", (d) => (d.isAirline ? "#1e293b" : "#0f172a"))
      .attr("pointer-events", "none")
      .text((d) => d.label);

    // Force simulation.
    const sim = d3.forceSimulation<BubbleNode>(nodes)
      .force("charge", d3.forceManyBody().strength((d: any) => -(d.radius ?? 20) * 2.5))
      .force("center", d3.forceCenter(W / 2, H / 2))
      .force("collision", d3.forceCollide().radius((d: any) => (d.radius ?? 20) + PADDING / 2))
      .force("x", d3.forceX(W / 2).strength(0.03))
      .force("y", d3.forceY(H / 2).strength(0.03))
      .alphaDecay(0.02)
      .stop();

    // Run simulation to convergence (or ~300 iterations).
    for (let i = 0; i < 300; i++) sim.tick();
    sim.stop();

    // Apply final positions.
    nodeSel
      .attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);

    // Interactions.
    nodeSel
      .on("click", (_event: MouseEvent, d: BubbleNode) => {
        if (d.isAirline) {
          setFocusCarrier(d.carrierCode);
        } else {
          // Clicking an airport goes back to airlines.
          setFocusCarrier(null);
        }
      })
      .on("mouseover", (event: MouseEvent, d: BubbleNode) => {
        showTooltip(event, d);
      })
      .on("mousemove", (event: MouseEvent) => {
        setTooltip((t) => (t ? { ...t, x: event.clientX, y: event.clientY } : t));
      })
      .on("mouseout", () => setTooltip(null));

    // Click background → back to root.
    svg.on("click", () => {
      setFocusCarrier(null);
    });

    function showTooltip(event: MouseEvent, d: BubbleNode) {
      const m = d.metrics;
      if (!m) return;
      const title = d.isAirline
        ? `${d.carrierName ?? d.label}（${d.label}）`
        : `${d.carrierName ?? ""} · ${d.label}`;
      setTooltip({
        x: event.clientX,
        y: event.clientY,
        title,
        lines: [
          `到达航班总数：${formatMetric(m.arr_flights)}`,
          `延误15分钟以上：${formatMetric(m.arr_del15)}`,
          `航班取消数：${formatMetric(m.arr_cancelled)}`,
          `航班备降数：${formatMetric(m.arr_diverted)}`,
          `总延误时长：${formatMetric(m.arr_delay)} 分钟`,
        ],
      });
    }

    return () => {
      sim.stop();
      svg.on("click", null);
      svg.selectAll("*").remove();
    };
  }, [nodes, focusCarrier, airlines]);

  // Color helpers (same logic as before, adapted to new node shape).
  const carrierHue = (node: BubbleNode): number => hueMap.get(node.carrierCode) ?? 0;
  const fillFor = (node: BubbleNode): string => {
    const h = carrierHue(node);
    return d3.hsl(h, node.isAirline ? 0.45 : 0.55, node.isAirline ? 0.85 : 0.6).formatHex();
  };
  const strokeFor = (node: BubbleNode): string =>
    d3.hsl(carrierHue(node), 0.6, 0.4).formatHex();

  const handleBack = () => setFocusCarrier(null);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            航空公司 / 机场气泡图
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {focusCarrier
              ? `点击空白或机场返回 · ${airlines.find(a => a.carrierCode === focusCarrier)?.carrierName ?? focusCarrier} 的机场`
              : "点击航司下钻机场"
            }
          </Typography>
        </Box>
        <Button size="small" variant="outlined" disabled={!canGoBack} onClick={handleBack}>
          返回全部航司
        </Button>
      </Box>

      <Box sx={{ position: "relative", width: "100%", maxWidth: W, mx: "auto" }}>
        <svg
          ref={svgRef}
          width="100%"
          height={H}
          style={{ display: "block" }}
          role="img"
          aria-label="航空公司机场延误气泡图"
          onMouseLeave={() => setTooltip(null)}
        />
        {loading && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <CircularProgress size={28} />
          </Box>
        )}
        {!loading && empty && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              color: "text.secondary",
              border: "1px dashed",
              borderColor: "divider",
              borderRadius: 2,
            }}
          >
            <Typography>当前筛选条件下没有匹配的数据</Typography>
          </Box>
        )}
      </Box>

      {tooltip && (
        <Box
          sx={{
            position: "fixed",
            left: tooltip.x + 12,
            top: tooltip.y + 12,
            pointerEvents: "none",
            zIndex: 1300,
            bgcolor: "rgba(15,23,42,0.94)",
            color: "#fff",
            px: 1.5,
            py: 1,
            borderRadius: 1,
            fontSize: 12,
            lineHeight: 1.7,
            boxShadow: 3,
            maxWidth: 280,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 2 }}>{tooltip.title}</div>
          {tooltip.lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </Box>
      )}
    </Paper>
  );
}
