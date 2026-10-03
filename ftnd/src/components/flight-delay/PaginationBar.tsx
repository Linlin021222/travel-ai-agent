"use client";

import FirstPageIcon from "@mui/icons-material/FirstPage";
import LastPageIcon from "@mui/icons-material/LastPage";
import KeyboardArrowLeftIcon from "@mui/icons-material/KeyboardArrowLeft";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { PAGE_SIZE_OPTIONS } from "@/lib/flight-delay";

interface PaginationBarProps {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  rangeStart: number;
  rangeEnd: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

type PageToken = number | "gap-left" | "gap-right";

function buildPages(current: number, totalPages: number): PageToken[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  let start = Math.max(2, current - 2);
  let end = Math.min(totalPages - 1, current + 2);
  if (current <= 4) {
    start = 2;
    end = 5;
  }
  if (current >= totalPages - 3) {
    start = totalPages - 4;
    end = totalPages - 1;
  }
  const pages: PageToken[] = [1];
  if (start > 2) pages.push("gap-left");
  for (let page = start; page <= end; page += 1) pages.push(page);
  if (end < totalPages - 1) pages.push("gap-right");
  pages.push(totalPages);
  return pages;
}

export default function PaginationBar({
  total,
  page,
  pageSize,
  totalPages,
  rangeStart,
  rangeEnd,
  onPageChange,
  onPageSizeChange,
}: PaginationBarProps) {
  const pages = buildPages(page, totalPages);

  return (
    <Stack
      direction={{ xs: "column", md: "row" }}
      spacing={2}
      sx={{ mt: 1.5, alignItems: "center" }}
    >
      <Typography variant="body2" color="text.secondary">
        显示第 {rangeStart.toLocaleString()} - {rangeEnd.toLocaleString()} 条，共 {total.toLocaleString()} 条
        {total > 0 && `（第 ${page} / ${totalPages} 页）`}
      </Typography>

      <Box sx={{ flexGrow: 1 }} />

      <TextField
        select
        size="small"
        label="每页"
        value={pageSize}
        onChange={(event) => onPageSizeChange(Number(event.target.value))}
        sx={{ width: 110 }}
      >
        {PAGE_SIZE_OPTIONS.map((option) => (
          <MenuItem key={option} value={option}>
            {option} 条
          </MenuItem>
        ))}
      </TextField>

      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
        <IconButton size="small" disabled={page <= 1} onClick={() => onPageChange(1)} title="首页">
          <FirstPageIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          title="上一页"
        >
          <KeyboardArrowLeftIcon fontSize="small" />
        </IconButton>
        {pages.map((token) =>
          typeof token === "number" ? (
            <Button
              key={token}
              size="small"
              variant={token === page ? "contained" : "text"}
              onClick={() => onPageChange(token)}
              sx={{ minWidth: 36, px: 1 }}
            >
              {token}
            </Button>
          ) : (
            <Typography key={token} variant="body2" color="text.secondary" sx={{ px: 0.5 }}>
              …
            </Typography>
          ),
        )}
        <IconButton
          size="small"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          title="下一页"
        >
          <KeyboardArrowRightIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          disabled={page >= totalPages}
          onClick={() => onPageChange(totalPages)}
          title="末页"
        >
          <LastPageIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Stack>
  );
}
