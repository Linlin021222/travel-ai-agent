"use client";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import type { MetricCardData } from "@/lib/ai-agent";
import { formatPercent } from "@/lib/format";

/**
 * Dashboard-style KPI card group.
 *
 * Reuses the compact K/M/B formatting produced by the back end and shows the
 * optional "量 + 百分比" pair underneath each value.
 */
export default function MetricCardMessage({ payload }: { payload?: MetricCardData | null }) {
  const cards = payload?.cards ?? [];

  if (!cards.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        （指标数据缺失）
      </Typography>
    );
  }

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(4, minmax(0, 1fr))" },
        gap: 1,
      }}
    >
      {cards.map((card) => (
        <Paper
          key={card.key}
          variant="outlined"
          sx={{
            p: 1.2,
            borderRadius: 1.5,
            bgcolor: "grey.50",
            borderColor: "divider",
            minWidth: 0,
          }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mb: 0.4, lineHeight: 1.4 }}
          >
            {card.label}
          </Typography>

          <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.4, flexWrap: "wrap" }}>
            <Typography
              variant="h6"
              component="span"
              sx={{ fontWeight: 700, lineHeight: 1.1, fontSize: 20 }}
            >
              {card.formatted}
            </Typography>
            {card.unit && (
              <Typography variant="caption" color="text.secondary" component="span">
                {card.unit}
              </Typography>
            )}
          </Box>

          {card.ratio && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.4 }}>
              {card.ratio.label} {formatPercent(card.ratio.value)}
            </Typography>
          )}
        </Paper>
      ))}
    </Box>
  );
}
