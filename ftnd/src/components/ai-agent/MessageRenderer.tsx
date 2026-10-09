"use client";

import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import PersonOutlineIcon from "@mui/icons-material/PersonOutlined";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import {
  isToolResult,
  type BarChartData,
  type BubbleChartData,
  type MetricCardData,
  type TablePayload,
  type ToolResultPayload,
  type WritePreviewData,
} from "@/lib/ai-agent";
import type { ChatMessage } from "@/lib/ai-agent";
import BarChartMessage from "./messages/BarChartMessage";
import BubbleChartMessage from "./messages/BubbleChartMessage";
import ChartMessage from "./messages/ChartMessage";
import ConfirmMessage from "./messages/ConfirmMessage";
import MetricCardMessage from "./messages/MetricCardMessage";
import ReportMessage from "./messages/ReportMessage";
import TableMessage from "./messages/TableMessage";
import TextMessage from "./messages/TextMessage";
import ToolErrorMessage from "./messages/ToolErrorMessage";
import WritePreviewMessage from "./messages/WritePreviewMessage";

function formatSize(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface MessageRendererProps {
  message: ChatMessage;
  onConfirm?: (messageId: string, actionId: string, label: string) => void;
}

/**
 * Dispatcher: picks the renderer by `message.type` and applies the
 * user/assistant layout (right vs left, colour and avatar).
 */
export default function MessageRenderer({ message, onConfirm }: MessageRendererProps) {
  const isUser = message.role === "user";

  // Tool results carry their own envelope: `resultType` picks the component and
  // `data.chartType` refines charts into cards / bars / bubbles.
  const toolResult: ToolResultPayload | null = isToolResult(message.payload)
    ? (message.payload as ToolResultPayload)
    : null;
  const toolFailed = Boolean(toolResult && toolResult.code !== 0);
  const chartType = (toolResult?.data as { chartType?: string } | null)?.chartType ?? null;
  const tablePayload = toolResult
    ? (toolResult.data as TablePayload | null)
    : (message.payload as TablePayload | null);

  return (
    <Box
      sx={{
        display: "flex",
        gap: 1.2,
        flexDirection: isUser ? "row-reverse" : "row",
        alignItems: "flex-start",
        mb: 2,
      }}
    >
      <Avatar
        sx={{
          width: 30,
          height: 30,
          bgcolor: isUser ? "primary.main" : "grey.200",
          color: isUser ? "#fff" : "grey.700",
          flexShrink: 0,
        }}
      >
        {isUser ? (
          <PersonOutlineIcon sx={{ fontSize: 18 }} />
        ) : (
          <SmartToyOutlinedIcon sx={{ fontSize: 18 }} />
        )}
      </Avatar>

      <Box sx={{ maxWidth: "78%", minWidth: 0 }}>
        <Paper
          elevation={0}
          sx={{
            p: 1.4,
            borderRadius: 2,
            border: "1px solid",
            borderColor: message.error ? "error.light" : isUser ? "primary.light" : "divider",
            bgcolor: message.error
              ? "error.50"
              : isUser
                ? "primary.50"
                : "background.paper",
            fontSize: 14,
            wordBreak: "break-word",
          }}
        >
          {/* attachments (user messages) */}
          {!!message.attachments?.length && (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.6, mb: 1 }}>
              {message.attachments.map((file, index) => (
                <Chip
                  key={`${file.name}-${index}`}
                  size="small"
                  icon={<AttachFileIcon />}
                  label={`${file.name}${formatSize(file.size) ? ` · ${formatSize(file.size)}` : ""}`}
                  variant="outlined"
                />
              ))}
            </Box>
          )}

          {/* content: for non-text types `content` is a short lead-in line */}
          {message.content && (message.type === "text" || isUser) && (
            <TextMessage content={message.content} />
          )}

          {!isUser && toolFailed && (
            <ToolErrorMessage
              code={toolResult?.code ?? 500}
              message={toolResult?.message}
              toolName={toolResult?.toolName}
            />
          )}

          {!isUser && !toolFailed && message.type === "table" && (
            <>
              {message.content && (
                <Typography variant="body2" sx={{ mb: 1, lineHeight: 1.7 }}>
                  {message.content}
                </Typography>
              )}
              <TableMessage payload={tablePayload} />
            </>
          )}

          {!isUser && !toolFailed && message.type === "chart" && (
            <>
              {message.content && (
                <Typography variant="body2" sx={{ mb: 1, lineHeight: 1.7 }}>
                  {message.content}
                </Typography>
              )}
              {chartType === "metric" && (
                <MetricCardMessage payload={toolResult?.data as MetricCardData | null} />
              )}
              {chartType === "bar" && (
                <BarChartMessage payload={toolResult?.data as BarChartData | null} />
              )}
              {chartType === "bubble" && (
                <BubbleChartMessage payload={toolResult?.data as BubbleChartData | null} />
              )}
              {chartType === null && <ChartMessage payload={message.payload as never} />}
            </>
          )}

          {!isUser && !toolFailed && message.type === "preview" && (
            <>
              {message.content && (
                <Typography variant="body2" sx={{ mb: 1, lineHeight: 1.7 }}>
                  {message.content}
                </Typography>
              )}
              <WritePreviewMessage payload={toolResult?.data as WritePreviewData | null} />
            </>
          )}

          {!isUser && message.type === "report" && (
            <>
              {message.content && (
                <Typography variant="body2" sx={{ mb: 1, lineHeight: 1.7 }}>
                  {message.content}
                </Typography>
              )}
              <ReportMessage payload={message.payload as never} />
            </>
          )}

          {!isUser && message.type === "confirm" && (
            <>
              {message.content && (
                <Typography variant="body2" sx={{ mb: 1, lineHeight: 1.7 }}>
                  {message.content}
                </Typography>
              )}
              <ConfirmMessage
                payload={message.payload as never}
                confirmation={message.confirmation}
                onChoose={(actionId, label) => onConfirm?.(message.id, actionId, label)}
              />
            </>
          )}

          {message.pending && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
              <CircularProgress size={14} />
              <Typography variant="caption" color="text.secondary">
                正在生成回复…
              </Typography>
            </Box>
          )}
        </Paper>

        {message.createdAt && !message.pending && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mt: 0.4, display: "block", textAlign: isUser ? "right" : "left" }}
          >
            {new Date(message.createdAt).toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
