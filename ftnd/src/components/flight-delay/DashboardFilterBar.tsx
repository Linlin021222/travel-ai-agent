"use client";

import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import FilterAltOffIcon from "@mui/icons-material/FilterAltOff";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useMemo, useState } from "react";
import {
  CHART_METRICS,
  CHART_METRIC_LABELS,
  type CodeOption,
  type DashboardFilters,
  EMPTY_DASHBOARD_FILTERS,
  type FilterOptions,
} from "@/lib/flight-delay";
import { apiRequest, buildQuery } from "@/lib/api";

interface DashboardFilterBarProps {
  filters: DashboardFilters;
  onChange: (next: DashboardFilters) => void;
  onReset: () => void;
  activeCount: number;
}

interface YearMonth {
  value: number; // YYYYMM
  label: string; // YYYY-MM
}

function ymLabel(value: number): string {
  const y = Math.floor(value / 100);
  const m = value % 100;
  return `${y}-${String(m).padStart(2, "0")}`;
}

export default function DashboardFilterBar({
  filters,
  onChange,
  onReset,
  activeCount,
}: DashboardFilterBarProps) {
  const [options, setOptions] = useState<FilterOptions | null>(null);

  // Keep the option lists cascading with the current carrier/airport selection.
  useEffect(() => {
    const params = buildQuery({
      carriers: filters.carriers.length ? filters.carriers.join(",") : undefined,
      airports: filters.airports.length ? filters.airports.join(",") : undefined,
    });
    let cancelled = false;
    apiRequest<FilterOptions>(`/flight-delay/filter-options${params}`)
      .then((data) => {
        if (!cancelled) setOptions(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [filters.carriers, filters.airports]);

  // All year-month combinations present in the data, bounded by available years.
  const yearMonths = useMemo<YearMonth[]>(() => {
    const years = options?.years ?? [];
    const list: YearMonth[] = [];
    for (const year of years) {
      for (let month = 1; month <= 12; month += 1) {
        const value = year * 100 + month;
        list.push({ value, label: ymLabel(value) });
      }
    }
    return list;
  }, [options]);

  const carrierMap = useMemo(() => {
    const map = new Map<string, CodeOption>();
    for (const item of options?.carriers ?? []) map.set(item.code, item);
    return map;
  }, [options]);

  const airportMap = useMemo(() => {
    const map = new Map<string, CodeOption>();
    for (const item of options?.airports ?? []) map.set(item.code, item);
    return map;
  }, [options]);

  const selectedCarriers = useMemo(
    () => filters.carriers.map((code) => carrierMap.get(code) ?? { code, name: code }),
    [filters.carriers, carrierMap],
  );
  const selectedAirports = useMemo(
    () => filters.airports.map((code) => airportMap.get(code) ?? { code, name: code }),
    [filters.airports, airportMap],
  );

  const metricBounds = filters.metric
    ? options?.numericBounds?.[filters.metric]
    : undefined;
  const metricRangeHint =
    metricBounds && Number.isFinite(metricBounds.min) && Number.isFinite(metricBounds.max)
      ? `全量范围 ${Math.floor(metricBounds.min).toLocaleString()} ~ ${Math.ceil(
          metricBounds.max,
        ).toLocaleString()}`
      : "";

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Stack direction="row" spacing={1} sx={{ mb: 1.5, alignItems: "center" }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          图表筛选
        </Typography>
        {activeCount > 0 && (
          <Chip size="small" color="primary" variant="outlined" label={`${activeCount} 项生效`} />
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button size="small" startIcon={<FilterAltOffIcon />} onClick={onReset}>
          重置筛选
        </Button>
      </Stack>

      <Stack
        direction={{ xs: "column", lg: "row" }}
        spacing={2}
        sx={{ "& > *": { flex: { lg: "1 1 0" }, minWidth: { lg: 200 } } }}
      >
        {/* Date range: start / end year-month */}
        <FormControl size="small" fullWidth>
          <InputLabel id="date-from-label">起始年月</InputLabel>
          <Select
            labelId="date-from-label"
            label="起始年月"
            value={filters.dateFrom ?? ""}
            onChange={(event) => {
              const raw = event.target.value as unknown as string;
              onChange({ ...filters, dateFrom: raw === "" ? null : Number(raw) });
            }}
          >
            <MenuItem value="">不限</MenuItem>
            {yearMonths.map((ym) => (
              <MenuItem key={ym.value} value={ym.value} disabled={filters.dateTo !== null && ym.value > filters.dateTo}>
                {ym.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" fullWidth>
          <InputLabel id="date-to-label">结束年月</InputLabel>
          <Select
            labelId="date-to-label"
            label="结束年月"
            value={filters.dateTo ?? ""}
            onChange={(event) => {
              const raw = event.target.value as unknown as string;
              onChange({ ...filters, dateTo: raw === "" ? null : Number(raw) });
            }}
          >
            <MenuItem value="">不限</MenuItem>
            {yearMonths.map((ym) => (
              <MenuItem key={ym.value} value={ym.value} disabled={filters.dateFrom !== null && ym.value < filters.dateFrom}>
                {ym.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Autocomplete
          multiple
          disableCloseOnSelect
          size="small"
          options={options?.carriers ?? []}
          getOptionLabel={(option) => `${option.code} - ${option.name}`}
          isOptionEqualToValue={(a, b) => a.code === b.code}
          value={selectedCarriers}
          onChange={(_, value) => onChange({ ...filters, carriers: value.map((item) => item.code) })}
          renderInput={(params) => (
            <TextField {...params} label="航空公司（可搜索代码/名称）" placeholder="全部航司" />
          )}
          renderOption={(props, option) => (
            <li {...props} key={option.code}>
              <Box sx={{ display: "flex", gap: 1, alignItems: "baseline" }}>
                <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 38 }}>
                  {option.code}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {option.name}
                </Typography>
              </Box>
            </li>
          )}
          renderValue={(value, getItemProps) =>
            value.map((option, index) => {
              const { key, ...itemProps } = getItemProps({ index });
              return <Chip key={key} {...itemProps} size="small" label={option.code} />;
            })
          }
        />

        <Autocomplete
          multiple
          disableCloseOnSelect
          size="small"
          options={options?.airports ?? []}
          getOptionLabel={(option) => `${option.code} - ${option.name}`}
          isOptionEqualToValue={(a, b) => a.code === b.code}
          value={selectedAirports}
          onChange={(_, value) => onChange({ ...filters, airports: value.map((item) => item.code) })}
          renderInput={(params) => (
            <TextField {...params} label="机场（可搜索代码/名称）" placeholder="全部机场" />
          )}
          renderOption={(props, option) => (
            <li {...props} key={option.code}>
              <Box sx={{ display: "flex", gap: 1, alignItems: "baseline" }}>
                <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 38 }}>
                  {option.code}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {option.name}
                </Typography>
              </Box>
            </li>
          )}
          renderValue={(value, getItemProps) =>
            value.map((option, index) => {
              const { key, ...itemProps } = getItemProps({ index });
              return <Chip key={key} {...itemProps} size="small" label={option.code} />;
            })
          }
        />
      </Stack>

      <Divider sx={{ my: 2 }} />

      <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap", alignItems: "flex-end" }}>
        {/* Y-axis metric single select */}
        <FormControl size="small" sx={{ minWidth: 240 }}>
          <InputLabel id="metric-label">Y 轴指标</InputLabel>
          <Select
            labelId="metric-label"
            label="Y 轴指标"
            value={filters.metric}
            onChange={(event) =>
              onChange({
                ...filters,
                metric: event.target.value as DashboardFilters["metric"],
                metricRange: {},
              })
            }
          >
            {CHART_METRICS.map((metric) => (
              <MenuItem key={metric} value={metric}>
                {CHART_METRIC_LABELS[metric]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Metric range: "current y-axis option range" */}
        <TextField
          size="small"
          type="number"
          label="指标最小值"
          value={filters.metricRange.min ?? ""}
          onChange={(event) =>
            onChange({
              ...filters,
              metricRange: { ...filters.metricRange, min: event.target.value === "" ? undefined : Number(event.target.value) },
            })
          }
          sx={{ width: 160 }}
        />
        <Typography variant="body2" color="text.secondary" sx={{ pb: 1 }}>
          ~
        </Typography>
        <TextField
          size="small"
          type="number"
          label="指标最大值"
          value={filters.metricRange.max ?? ""}
          onChange={(event) =>
            onChange({
              ...filters,
              metricRange: { ...filters.metricRange, max: event.target.value === "" ? undefined : Number(event.target.value) },
            })
          }
          sx={{ width: 160 }}
        />
        {metricRangeHint && (
          <Typography variant="caption" color="text.secondary" sx={{ pb: 1 }}>
            {metricRangeHint}
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}

export function countDashboardFilters(filters: DashboardFilters): number {
  let count = filters.carriers.length + filters.airports.length;
  if (filters.dateFrom !== null) count += 1;
  if (filters.dateTo !== null) count += 1;
  if (filters.metricRange.min !== undefined) count += 1;
  if (filters.metricRange.max !== undefined) count += 1;
  return count;
}

export { EMPTY_DASHBOARD_FILTERS };
