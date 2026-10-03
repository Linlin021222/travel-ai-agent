"use client";

import MainLayout from "@/components/MainLayout";
import BarChartCard from "@/components/flight-delay/BarChartCard";
import BubbleChart from "@/components/flight-delay/BubbleChart";
import DashboardFilterBar, {
  countDashboardFilters,
} from "@/components/flight-delay/DashboardFilterBar";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useMemo, useState } from "react";
import {
  EMPTY_DASHBOARD_FILTERS,
  type ChartDimension,
  type DashboardFilters,
  type BubblePoint,
} from "@/lib/flight-delay";
import { getBubble } from "@/lib/api";
import { toChartQuery } from "@/lib/flight-delay";

export default function DashboardPage() {
  const [filters, setFilters] = useState<DashboardFilters>(EMPTY_DASHBOARD_FILTERS);
  const [dimensionTop, setDimensionTop] = useState<ChartDimension>("carrier");
  const [dimensionBottom, setDimensionBottom] = useState<ChartDimension>("date");

  const [bubbleData, setBubbleData] = useState<BubblePoint[]>([]);
  const [bubbleLoading, setBubbleLoading] = useState(false);

  const query = useMemo(() => toChartQuery(filters), [filters]);

  // Bubble data is shared by both bar charts via the same filter state.
  useEffect(() => {
    let cancelled = false;
    setBubbleLoading(true);
    getBubble(query)
      .then((res) => {
        if (!cancelled) setBubbleData(res.data);
      })
      .catch(() => {
        if (!cancelled) setBubbleData([]);
      })
      .finally(() => {
        if (!cancelled) setBubbleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  const activeCount = countDashboardFilters(filters);

  return (
    <MainLayout>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
        Dashboard
      </Typography>

      <DashboardFilterBar
        filters={filters}
        onChange={setFilters}
        onReset={() => setFilters(EMPTY_DASHBOARD_FILTERS)}
        activeCount={activeCount}
      />

      <Stack spacing={2}>
        <BarChartCard
          title="图表一"
          dimension={dimensionTop}
          onDimensionChange={setDimensionTop}
          filters={filters}
        />
        <BarChartCard
          title="图表二"
          dimension={dimensionBottom}
          onDimensionChange={setDimensionBottom}
          filters={filters}
        />
        <BubbleChart data={bubbleData} loading={bubbleLoading} />
      </Stack>
    </MainLayout>
  );
}
