"use client";

import Box from "@mui/material/Box";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  COLUMNS,
  STICKY_LEFT_COUNT,
  formatMetric,
  type FlightDelayField,
  type FlightDelayRow,
} from "@/lib/flight-delay";

export interface SortState {
  sortBy?: FlightDelayField;
  sortDir?: "asc" | "desc";
}

interface DelayTableProps {
  rows: FlightDelayRow[];
  widths: Record<string, number>;
  onWidthChange: (key: string, width: number) => void;
  wrap: boolean;
  sort: SortState;
  onSortChange: (sort: SortState) => void;
  maxHeight?: number | string;
}

const MIN_WIDTH = 60;

export default function DelayTable({
  rows,
  widths,
  onWidthChange,
  wrap,
  sort,
  onSortChange,
  maxHeight = "calc(100vh - 340px)",
}: DelayTableProps) {
  const [resizingKey, setResizingKey] = useState<string | null>(null);
  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  const resolvedWidths = useMemo(
    () =>
      COLUMNS.reduce<Record<string, number>>((acc, column) => {
        acc[column.key] = widths[column.key] ?? column.width;
        return acc;
      }, {}),
    [widths],
  );

  const totalWidth = useMemo(
    () => COLUMNS.reduce((sum, column) => sum + resolvedWidths[column.key], 0),
    [resolvedWidths],
  );

  const stickyOffsets = useMemo(() => {
    const offsets: number[] = [];
    let acc = 0;
    for (let i = 0; i < STICKY_LEFT_COUNT; i += 1) {
      offsets.push(acc);
      acc += resolvedWidths[COLUMNS[i].key];
    }
    return offsets;
  }, [resolvedWidths]);

  const resizeStart = useRef<{ x: number; width: number } | null>(null);

  const startResize = useCallback((event: React.MouseEvent, key: string) => {
    event.preventDefault();
    event.stopPropagation();
    resizeStart.current = { x: event.clientX, width: widthsRef.current[key] ?? 120 };
    setResizingKey(key);
  }, []);

  useEffect(() => {
    if (!resizingKey) return;
    const start = resizeStart.current;
    if (!start) return;

    const onMove = (event: MouseEvent) => {
      const next = Math.max(MIN_WIDTH, Math.round(start.width + event.clientX - start.x));
      onWidthChange(resizingKey, next);
    };
    const onUp = () => setResizingKey(null);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizingKey, onWidthChange]);

  const toggleSort = (key: FlightDelayField) => {
    if (sort.sortBy !== key) {
      onSortChange({ sortBy: key, sortDir: "asc" });
      return;
    }
    if (sort.sortDir === "asc") {
      onSortChange({ sortBy: key, sortDir: "desc" });
      return;
    }
    onSortChange({});
  };

  return (
    <TableContainer
      sx={{
        maxHeight,
        overflow: "auto",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        position: "relative",
        userSelect: resizingKey ? "none" : undefined,
        cursor: resizingKey ? "col-resize" : undefined,
      }}
    >
      <Table stickyHeader size="small" sx={{ width: totalWidth, tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0 }}>
        <TableHead>
          <TableRow>
            {COLUMNS.map((column, index) => {
              const stickyLeft = index < STICKY_LEFT_COUNT;
              const width = resolvedWidths[column.key];
              return (
                <TableCell
                  key={column.key}
                  align={column.numeric ? "right" : "left"}
                  onClick={() => toggleSort(column.key)}
                  sx={{
                    width,
                    minWidth: width,
                    maxWidth: width,
                    position: "sticky",
                    top: 0,
                    left: stickyLeft ? stickyOffsets[index] : undefined,
                    zIndex: stickyLeft ? 3 : 2,
                    bgcolor: "#eef2f7",
                    cursor: "pointer",
                    whiteSpace: wrap ? "normal" : "nowrap",
                    lineHeight: 1.3,
                    py: 1,
                    px: 1.25,
                    borderRight: "1px solid",
                    borderColor: "divider",
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, justifyContent: column.numeric ? "flex-end" : "flex-start" }}>
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>
                      {column.label}
                    </Typography>
                    {sort.sortBy === column.key && (
                      <Typography variant="caption" sx={{ fontWeight: 700 }}>
                        {sort.sortDir === "asc" ? "▲" : "▼"}
                      </Typography>
                    )}
                  </Box>
                  <Box
                    onMouseDown={(event) => startResize(event, column.key)}
                    sx={{
                      position: "absolute",
                      top: 0,
                      right: -3,
                      width: 8,
                      height: "100%",
                      cursor: "col-resize",
                      zIndex: 4,
                      "&:hover": { bgcolor: "primary.main", opacity: 0.4 },
                    }}
                  />
                </TableCell>
              );
            })}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, rowIndex) => (
            <TableRow
              key={`${row.year}-${row.month}-${row.carrier_code}-${row.airport_code}-${rowIndex}`}
              hover
              sx={{ "&:nth-of-type(even)": { bgcolor: "action.hover" } }}
            >
              {COLUMNS.map((column, index) => {
                const stickyLeft = index < STICKY_LEFT_COUNT;
                const raw = row[column.key];
                const text = column.numeric ? formatMetric(raw as number) : String(raw ?? "");
                const width = resolvedWidths[column.key];
                return (
                  <TableCell
                    key={column.key}
                    align={column.numeric ? "right" : "left"}
                    title={text}
                    sx={{
                      width,
                      minWidth: width,
                      maxWidth: width,
                      position: stickyLeft ? "sticky" : "static",
                      left: stickyLeft ? stickyOffsets[index] : undefined,
                      zIndex: stickyLeft ? 1 : undefined,
                      bgcolor: stickyLeft
                        ? rowIndex % 2 === 1
                          ? "action.hover"
                          : "background.paper"
                        : undefined,
                      borderRight: "1px solid",
                      borderColor: "divider",
                      py: 0.75,
                      px: 1.25,
                      whiteSpace: wrap ? "normal" : "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {text}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
