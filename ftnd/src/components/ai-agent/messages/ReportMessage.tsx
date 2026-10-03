"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import type { ReportPayload } from "@/lib/ai-agent";

/** Report preview card — mimics a generated document summary. */
export default function ReportMessage({ payload }: { payload?: ReportPayload | null }) {
  if (!payload) {
    return (
      <Typography variant="body2" color="text.secondary">
        （报表数据缺失）
      </Typography>
    );
  }

  return (
    <Paper
      variant="outlined"
      sx={{ p: 1.6, borderRadius: 1.5, bgcolor: "background.paper", maxWidth: 480 }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.8 }}>
        <DescriptionOutlinedIcon fontSize="small" color="primary" />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {payload.title ?? "报表预览"}
        </Typography>
      </Box>

      {payload.summary && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1, lineHeight: 1.7 }}>
          {payload.summary}
        </Typography>
      )}

      {!!payload.meta?.length && (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.6, mb: 1 }}>
          {payload.meta.map((item) => (
            <Chip key={item.label} size="small" variant="outlined" label={`${item.label}：${item.value}`} />
          ))}
        </Box>
      )}

      <Divider sx={{ my: 1 }} />

      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.9 }}>
        {(payload.sections ?? []).map((section, index) => (
          <Box key={index}>
            <Typography variant="caption" sx={{ fontWeight: 700, color: "primary.main" }}>
              {section.heading}
            </Typography>
            <Typography variant="body2" sx={{ lineHeight: 1.7 }}>
              {section.body}
            </Typography>
          </Box>
        ))}
      </Box>

      <Button size="small" variant="outlined" sx={{ mt: 1.2 }} disabled>
        打开完整报表（示例）
      </Button>
    </Paper>
  );
}
