"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

type Severity = "error" | "warning" | "info";

function severityFor(code: number): Severity {
  if (code === 403) return "warning";
  if (code === 404 || code === 409 || code === 400) return "info";
  return "error";
}

/**
 * Unified failure presentation for tool executions.
 *
 * The back end already returns a human-readable `message` for every failure
 * code, so the UI never has to translate raw exceptions.
 */
export default function ToolErrorMessage({
  code,
  message,
  toolName,
}: {
  code: number;
  message?: string | null;
  toolName?: string | null;
}) {
  return (
    <Box>
      <Alert severity={severityFor(code)} variant="outlined" sx={{ borderRadius: 1.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {message || "工具执行失败，请稍后重试"}
        </Typography>
      </Alert>
      {(toolName || code !== 0) && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.6, display: "block" }}>
          {toolName ? `工具：${toolName}` : ""}
          {toolName && code !== 0 ? " · " : ""}
          {code !== 0 ? `错误码 ${code}` : ""}
        </Typography>
      )}
    </Box>
  );
}
