"use client";

import FlightTakeoffIcon from "@mui/icons-material/FlightTakeoff";
import InboxIcon from "@mui/icons-material/Inbox";
import RefreshIcon from "@mui/icons-material/Refresh";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MainLayout from "@/components/MainLayout";
import DelayTable, { type SortState } from "@/components/flight-delay/DelayTable";
import FilterPanel from "@/components/flight-delay/FilterPanel";
import PaginationBar from "@/components/flight-delay/PaginationBar";
import { apiRequest, buildQuery } from "@/lib/api";
import {
  COLUMNS,
  EMPTY_FILTERS,
  createDefaultRanges,
  countActiveFilters,
  filterSignature,
  buildFilterParams,
  type FilterOptions,
  type Filters,
  type PagedResponse,
  type FlightDelayRow,
} from "@/lib/flight-delay";

const DEFAULT_WIDTHS = COLUMNS.reduce<Record<string, number>>((acc, column) => {
  acc[column.key] = column.width;
  return acc;
}, {});

export default function FlightInfoPage() {
  const [filters, setFilters] = useState<Filters>(() => ({
    ...EMPTY_FILTERS,
    ranges: createDefaultRanges(),
  }));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState<SortState>({});
  const [data, setData] = useState<PagedResponse<FlightDelayRow> | null>(null);
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [wrap, setWrap] = useState(false);
  const [widths, setWidths] = useState<Record<string, number>>(DEFAULT_WIDTHS);
  const [reloadToken, setReloadToken] = useState(0);

  const dataAbort = useRef<AbortController | null>(null);
  const optionsAbort = useRef<AbortController | null>(null);

  const signature = useMemo(() => filterSignature(filters), [filters]);
  const activeCount = useMemo(() => countActiveFilters(filters), [filters]);

  // ---- data ----------------------------------------------------------------
  useEffect(() => {
    const timer = window.setTimeout(() => {
      dataAbort.current?.abort();
      const controller = new AbortController();
      dataAbort.current = controller;
      setLoading(true);
      const params = buildFilterParams(filters, page, pageSize, sort);
      apiRequest<PagedResponse<FlightDelayRow>>(
        `/flight-delay${buildQuery(params)}`,
        { signal: controller.signal },
      )
        .then((response) => {
          setData(response);
          setError("");
        })
        .catch((requestError: unknown) => {
          if (requestError instanceof DOMException && requestError.name === "AbortError") return;
          setError(requestError instanceof Error ? requestError.message : "数据加载失败");
        })
        .finally(() => {
          if (dataAbort.current === controller) setLoading(false);
        });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [filters, page, pageSize, sort, reloadToken]);

  // ---- filter options (cascade off the current selection) ------------------
  useEffect(() => {
    const timer = window.setTimeout(() => {
      optionsAbort.current?.abort();
      const controller = new AbortController();
      optionsAbort.current = controller;
      const params = buildFilterParams(filters, 1, 20);
      apiRequest<FilterOptions>(`/flight-delay/filter-options${buildQuery(params)}`, {
        signal: controller.signal,
      })
        .then((response) => setOptions(response))
        .catch(() => {
          /* keep the previous options when the request fails */
        });
    }, 300);

    return () => window.clearTimeout(timer);
  }, [signature, reloadToken]);

  // Airports cascade off the carrier selection: drop selections that no longer
  // have any data for the current filter combination.
  useEffect(() => {
    if (!options || options.airports.length === 0) return;
    const available = new Set(options.airports.map((item) => item.code));
    const valid = filters.airports.filter((code) => available.has(code));
    if (valid.length !== filters.airports.length) {
      setFilters((previous) => ({ ...previous, airports: valid }));
      setPage(1);
    }
  }, [options, filters.airports]);

  const handleFiltersChange = useCallback((next: Filters) => {
    setFilters(next);
    setPage(1);
  }, []);

  const handleReset = useCallback(() => {
    setFilters({ ...EMPTY_FILTERS, ranges: createDefaultRanges() });
    setSort({});
    setPage(1);
  }, []);

  const handleWidthChange = useCallback((key: string, width: number) => {
    setWidths((previous) => ({ ...previous, [key]: width }));
  }, []);

  const total = data?.total ?? 0;
  const rows = data?.data ?? [];

  return (
    <MainLayout>
      <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: "center" }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Airline Delay Data
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <FormControlLabel
          control={<Switch checked={wrap} onChange={(event) => setWrap(event.target.checked)} />}
          label="长文本自动换行"
        />
        <Button size="small" onClick={() => setWidths(DEFAULT_WIDTHS)}>
          恢复默认列宽
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={() => setReloadToken((value) => value + 1)}
        >
          刷新
        </Button>
      </Stack>

      <FilterPanel
        options={options}
        filters={filters}
        activeCount={activeCount}
        onChange={handleFiltersChange}
        onReset={handleReset}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Box sx={{ position: "relative", minHeight: 120 }}>
          {loading && (
            <LinearProgress sx={{ position: "absolute", top: -6, left: 0, right: 0, zIndex: 5 }} />
          )}

          {!loading && total === 0 ? (
            <Box sx={{ py: 8, textAlign: "center" }}>
              <InboxIcon sx={{ fontSize: 56, color: "text.disabled" }} />
              <Typography variant="h6" sx={{ mt: 1.5, fontWeight: 700 }}>
                没有符合条件的数据
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                当前筛选条件下没有匹配的航班延误记录，试试放宽条件或直接重置。
              </Typography>
              <Button sx={{ mt: 2 }} variant="contained" onClick={handleReset}>
                重置筛选条件
              </Button>
            </Box>
          ) : (
            <>
              <DelayTable
                rows={rows}
                widths={widths}
                onWidthChange={handleWidthChange}
                wrap={wrap}
                sort={sort}
                onSortChange={(next) => {
                  setSort(next);
                  setPage(1);
                }}
              />
              <PaginationBar
                total={total}
                page={data?.page ?? 1}
                pageSize={data?.pageSize ?? pageSize}
                totalPages={data?.totalPages ?? 1}
                rangeStart={data?.rangeStart ?? 0}
                rangeEnd={data?.rangeEnd ?? 0}
                onPageChange={setPage}
                onPageSizeChange={(value) => {
                  setPageSize(value);
                  setPage(1);
                }}
              />
            </>
          )}
        </Box>
      </Paper>

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
        数据来源：Airline delay archive file，共 {COLUMNS.length} 个业务字段。表头可拖拽右侧边缘调整列宽，点击表头可排序，年份与月份列在横向滚动时保持固定。
        <FlightTakeoffIcon sx={{ fontSize: 14, verticalAlign: "middle", ml: 0.5 }} />
      </Typography>
    </MainLayout>
  );
}
