"use client";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import type { TablePayload } from "@/lib/ai-agent";

export default function TableMessage({ payload }: { payload?: TablePayload | null }) {
  if (!payload?.columns?.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        （表格数据缺失）
      </Typography>
    );
  }

  return (
    <Box>
      {payload.title && (
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.8 }}>
          {payload.title}
        </Typography>
      )}
      <TableContainer
        component={Paper}
        variant="outlined"
        sx={{ borderRadius: 1, maxHeight: 320 }}
      >
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {payload.columns.map((column) => (
                <TableCell
                  key={column.key}
                  align={column.align ?? "left"}
                  sx={{ fontWeight: 700, bgcolor: "grey.50", whiteSpace: "nowrap" }}
                >
                  {column.label}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {(payload.rows ?? []).map((row, rowIndex) => (
              <TableRow key={rowIndex} hover>
                {payload.columns.map((column) => (
                  <TableCell key={column.key} align={column.align ?? "left"}>
                    {String(row[column.key] ?? "")}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {payload.caption && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.6, display: "block" }}>
          {payload.caption}
        </Typography>
      )}
    </Box>
  );
}
