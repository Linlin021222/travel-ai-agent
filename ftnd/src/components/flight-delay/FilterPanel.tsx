"use client";

import AddIcon from "@mui/icons-material/Add";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import FilterAltOffIcon from "@mui/icons-material/FilterAltOff";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useMemo, useState } from "react";
import {
  RANGE_FIELDS,
  RANGE_FIELD_MAP,
  type CodeOption,
  type FilterOptions,
  type Filters,
  type RangeValue,
} from "@/lib/flight-delay";

interface FilterPanelProps {
  options: FilterOptions | null;
  filters: Filters;
  activeCount: number;
  onChange: (next: Filters) => void;
  onReset: () => void;
}

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

export default function FilterPanel({
  options,
  filters,
  activeCount,
  onChange,
  onReset,
}: FilterPanelProps) {
  const [pendingField, setPendingField] = useState<string | null>(null);

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

  // Months cascade off the year selection: only months that actually have data
  // for the selected years stay available.
  const monthOptions = useMemo(() => {
    const available = options?.months ?? [];
    if (available.length === 0) return MONTHS;
    const merged = new Set(available);
    for (const month of filters.months) merged.add(month);
    return MONTHS.filter((month) => merged.has(month));
  }, [options, filters.months]);

  const selectedCarriers = useMemo(
    () => filters.carriers.map((code) => carrierMap.get(code) ?? { code, name: code }),
    [filters.carriers, carrierMap],
  );

  const selectedAirports = useMemo(
    () => filters.airports.map((code) => airportMap.get(code) ?? { code, name: code }),
    [filters.airports, airportMap],
  );

  const activeRangeFields = RANGE_FIELDS.filter((field) => field.key in filters.ranges);
  const addableRangeFields = RANGE_FIELDS.filter((field) => !(field.key in filters.ranges));

  const updateRange = (key: string, patch: Partial<RangeValue>) => {
    onChange({
      ...filters,
      ranges: { ...filters.ranges, [key]: { ...filters.ranges[key], ...patch } },
    });
  };

  const removeRange = (key: string) => {
    const next = { ...filters.ranges };
    delete next[key];
    onChange({ ...filters, ranges: next });
  };

  const addRange = (key: string) => {
    if (!key) return;
    onChange({ ...filters, ranges: { ...filters.ranges, [key]: {} } });
    setPendingField(null);
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Stack direction="row" spacing={1} sx={{ mb: 1.5, alignItems: "center" }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          筛选条件
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
        sx={{ "& > *": { flex: { lg: "1 1 0" }, minWidth: { lg: 220 } } }}
      >
        <Autocomplete
          multiple
          disableCloseOnSelect
          size="small"
          options={options?.years ?? []}
          getOptionLabel={(option) => String(option)}
          value={filters.years}
          onChange={(_, value) => onChange({ ...filters, years: value })}
          renderInput={(params) => (
            <TextField {...params} label="年份（可多选）" placeholder="全部年份" />
          )}
          renderValue={(value, getItemProps) =>
            value.map((option, index) => {
              const { key, ...itemProps } = getItemProps({ index });
              return <Chip key={key} {...itemProps} size="small" label={option} />;
            })
          }
        />

        <Autocomplete
          multiple
          disableCloseOnSelect
          size="small"
          options={monthOptions}
          getOptionLabel={(option) => `${option} 月`}
          value={filters.months}
          onChange={(_, value) => onChange({ ...filters, months: value })}
          renderInput={(params) => (
            <TextField {...params} label="月份（可多选）" placeholder="全部月份" />
          )}
          renderValue={(value, getItemProps) =>
            value.map((option, index) => {
              const { key, ...itemProps } = getItemProps({ index });
              return <Chip key={key} {...itemProps} size="small" label={`${option} 月`} />;
            })
          }
        />

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

      <Stack direction="row" spacing={1} sx={{ mb: 1.5, alignItems: "center" }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          数值范围筛选
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Autocomplete
          size="small"
          sx={{ width: 260 }}
          options={addableRangeFields}
          getOptionLabel={(option) => option.label}
          value={null}
          inputValue={pendingField ?? ""}
          onInputChange={(_, value) => setPendingField(value)}
          onChange={(_, option) => option && addRange(option.key)}
          renderInput={(params) => (
            <TextField {...params} label="添加数值筛选字段" placeholder="选择字段" />
          )}
        />
      </Stack>

      {activeRangeFields.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          暂无数值筛选条件，可通过右上角下拉添加（如到达航班总数、延误 15 分钟以上航班数等）。
        </Typography>
      ) : (
        <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap" }}>
          {activeRangeFields.map((field) => {
            const range = filters.ranges[field.key] ?? {};
            const bounds = options?.numericBounds?.[field.key];
            const hint =
              bounds && Number.isFinite(bounds.min) && Number.isFinite(bounds.max)
                ? `全量范围 ${Math.floor(bounds.min).toLocaleString()} ~ ${Math.ceil(
                    bounds.max,
                  ).toLocaleString()}`
                : "";
            return (
              <Paper
                key={field.key}
                variant="outlined"
                sx={{ p: 1.5, minWidth: 300, flex: "1 1 300px", maxWidth: 380 }}
              >
                <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, flexGrow: 1 }}>
                    {RANGE_FIELD_MAP[field.key] ?? field.label}
                  </Typography>
                  <Tooltip title="移除该筛选字段">
                    <IconButton size="small" onClick={() => removeRange(field.key)}>
                      <DeleteOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
                <Stack direction="row" spacing={1} sx={{ mt: 0.5, alignItems: "center" }}>
                  <TextField
                    size="small"
                    type="number"
                    label="最小值"
                    value={range.min ?? ""}
                    onChange={(event) => updateRange(field.key, { min: event.target.value })}
                    sx={{ flex: 1 }}
                  />
                  <Typography variant="body2" color="text.secondary">
                    ~
                  </Typography>
                  <TextField
                    size="small"
                    type="number"
                    label="最大值"
                    value={range.max ?? ""}
                    onChange={(event) => updateRange(field.key, { max: event.target.value })}
                    sx={{ flex: 1 }}
                  />
                </Stack>
                {hint && (
                  <Typography variant="caption" color="text.secondary">
                    {hint}
                  </Typography>
                )}
              </Paper>
            );
          })}
          {addableRangeFields.length > 0 && (
            <Button
              size="small"
              startIcon={<AddIcon />}
              sx={{ alignSelf: "center" }}
              onClick={() => addRange(addableRangeFields[0].key)}
            >
              添加字段
            </Button>
          )}
        </Stack>
      )}
    </Paper>
  );
}
