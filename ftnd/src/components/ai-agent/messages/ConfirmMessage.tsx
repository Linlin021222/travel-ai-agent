"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlined";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlined";
import type { ConfirmPayload } from "@/lib/ai-agent";

interface ConfirmMessageProps {
  payload?: ConfirmPayload | null;
  /** Already-recorded choice (survives a page refresh). */
  confirmation?: { actionId: string; label: string; at: string } | null;
  onChoose?: (actionId: string, label: string) => void;
}

/** Human-in-the-loop confirmation card with primary/secondary actions. */
export default function ConfirmMessage({ payload, confirmation, onChoose }: ConfirmMessageProps) {
  if (!payload) {
    return (
      <Typography variant="body2" color="text.secondary">
        （确认项数据缺失）
      </Typography>
    );
  }

  const actions = payload.actions?.length
    ? payload.actions
    : [{ id: "confirm", label: payload.confirmText ?? "确认" }];

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.6,
        borderRadius: 1.5,
        maxWidth: 420,
        borderColor: confirmation ? "success.light" : "warning.light",
        bgcolor: confirmation ? "success.50" : "rgba(245,158,11,0.04)",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.6 }}>
        {confirmation ? (
          <CheckCircleOutlineIcon fontSize="small" color="success" />
        ) : (
          <HelpOutlineIcon fontSize="small" color="warning" />
        )}
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {payload.title ?? "需要确认"}
        </Typography>
      </Box>

      {payload.description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.2, lineHeight: 1.7 }}>
          {payload.description}
        </Typography>
      )}

      {confirmation ? (
        <Typography variant="caption" color="success.main" sx={{ fontWeight: 600 }}>
          已选择：{confirmation.label}
        </Typography>
      ) : (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
          {actions.map((action, index) => (
            <Button
              key={action.id}
              size="small"
              variant={index === 0 ? "contained" : "outlined"}
              onClick={() => onChoose?.(action.id, action.label)}
            >
              {action.label}
            </Button>
          ))}
          <Button
            size="small"
            color="inherit"
            onClick={() => onChoose?.("__cancel__", payload.cancelText ?? "取消")}
          >
            {payload.cancelText ?? "取消"}
          </Button>
        </Box>
      )}
    </Paper>
  );
}
