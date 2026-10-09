"use client";

import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import EditNoteIcon from "@mui/icons-material/EditNoteOutlined";
import { confirmWriteTool, type WritePreviewData } from "@/lib/ai-agent";

interface WritePreviewMessageProps {
  payload?: WritePreviewData | null;
}

const ACTION_LABEL: Record<WritePreviewData["action"], string> = {
  create: "新增",
  update: "修改",
  delete: "删除",
  batchDelete: "批量删除",
};

function renderValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Confirmation card for write tools.
 *
 * The list shows the diff the server computed from *current* data, so the user
 * confirms against what is really in the table. Only the one-time token is sent
 * back — the arguments never leave the server.
 */
export default function WritePreviewMessage({ payload }: WritePreviewMessageProps) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  if (!payload) {
    return (
      <Typography variant="body2" color="text.secondary">
        （预览数据缺失，请重新发起请求）
      </Typography>
    );
  }

  const execute = async () => {
    setState("running");
    try {
      const result = await confirmWriteTool(payload.toolName, payload.confirmationToken);
      if (result.code === 0) {
        setState("done");
        setMessage(result.message || "已执行");
      } else {
        setState("error");
        setMessage(result.message || "执行失败");
      }
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "执行失败，请稍后重试");
    }
  };

  const finished = state === "done" || state === "error";

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.6,
        borderRadius: 1.5,
        maxWidth: 520,
        borderColor: state === "error" ? "error.light" : state === "done" ? "success.light" : "warning.light",
        bgcolor: state === "done" ? "success.50" : "rgba(245,158,11,0.04)",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.8 }}>
        <EditNoteIcon fontSize="small" color={finished ? "success" : "warning"} />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          待确认的写入操作：{ACTION_LABEL[payload.action] ?? payload.action}
        </Typography>
        <Chip size="small" label={payload.toolName} variant="outlined" />
      </Box>

      <Typography variant="body2" sx={{ mb: 1, lineHeight: 1.7 }}>
        影响对象：<strong>{payload.targetLabel}</strong>
        {payload.affectedCount > 1 ? `（${payload.affectedCount} 条记录）` : ""}
      </Typography>

      {!!payload.changes?.length && (
        <Box
          component="table"
          sx={{ width: "100%", borderCollapse: "collapse", mb: 1, fontSize: 13 }}
        >
          <Box component="thead">
            <Box component="tr">
              {["字段", "当前值", "变更后"].map((head) => (
                <Box
                  key={head}
                  component="th"
                  sx={{ textAlign: "left", py: 0.5, borderBottom: "1px solid", borderColor: "divider" }}
                >
                  {head}
                </Box>
              ))}
            </Box>
          </Box>
          <Box component="tbody">
            {payload.changes.map((change) => (
              <Box component="tr" key={`${change.field}-${change.label}`}>
                <Box component="td" sx={{ py: 0.5, pr: 1, color: "text.secondary" }}>
                  {change.label}
                </Box>
                <Box component="td" sx={{ py: 0.5, pr: 1, color: "text.secondary" }}>
                  {renderValue(change.from)}
                </Box>
                <Box component="td" sx={{ py: 0.5, fontWeight: 600 }}>
                  {renderValue(change.to)}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {!!payload.warnings?.length && (
        <Alert severity="warning" sx={{ mb: 1, py: 0.4, fontSize: 13 }}>
          {payload.warnings.join("；")}
        </Alert>
      )}

      {message && (
        <Alert severity={state === "error" ? "error" : "success"} sx={{ mb: 1, py: 0.4, fontSize: 13 }}>
          {message}
        </Alert>
      )}

      {!finished && (
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <Button
            size="small"
            variant="contained"
            color={payload.action.includes("delete") ? "error" : "primary"}
            disabled={state === "running"}
            onClick={() => void execute()}
          >
            {state === "running" ? "执行中…" : "确认执行"}
          </Button>
          <Typography variant="caption" color="text.secondary">
            令牌 {Math.round(payload.expiresInSec / 60)} 分钟内有效，仅可使用一次
          </Typography>
        </Box>
      )}
    </Paper>
  );
}
