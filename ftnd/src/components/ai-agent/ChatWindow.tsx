"use client";

import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddCommentOutlinedIcon from "@mui/icons-material/AddCommentOutlined";
import CloseIcon from "@mui/icons-material/Close";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import { useChatSession } from "@/lib/useChatSession";
import ChatInput from "./ChatInput";
import MessageRenderer from "./MessageRenderer";

export default function ChatWindow({ onClose }: { onClose: () => void }) {
  const {
    messages,
    providers,
    provider,
    setProvider,
    loading,
    sending,
    error,
    scrollRef,
    sendMessage,
    confirmAction,
    startNewSession,
  } = useChatSession();

  return (
    <Paper
      elevation={8}
      data-testid="chat-window"
      sx={{
        width: 460,
        maxWidth: "calc(100vw - 32px)",
        height: 620,
        maxHeight: "calc(100vh - 96px)",
        display: "flex",
        flexDirection: "column",
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      {/* header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.6,
          py: 1.2,
          bgcolor: "primary.main",
          color: "#fff",
        }}
      >
        <SmartToyOutlinedIcon fontSize="small" />
        <Typography variant="subtitle2" sx={{ fontWeight: 700, flexGrow: 1 }}>
          AI 数据分析助手
        </Typography>

        {providers && (
          <TextField
            select
            size="small"
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            sx={{
              minWidth: 130,
              "& .MuiInputBase-root": { color: "#fff", fontSize: 12 },
              "& .MuiOutlinedInput-notchedOutline": { borderColor: "rgba(255,255,255,0.4)" },
              "& .MuiSvgIcon-root": { color: "#fff" },
            }}
          >
            <MenuItem value="" sx={{ fontSize: 12 }}>
              默认（{providers.default}）
            </MenuItem>
            {providers.providers.map((item) => (
              <MenuItem
                key={item.id}
                value={item.id}
                disabled={!item.configured}
                sx={{ fontSize: 12 }}
              >
                {item.label}
                {!item.configured ? "（未配置）" : ""}
              </MenuItem>
            ))}
          </TextField>
        )}

        <Tooltip title="新建对话">
          <IconButton size="small" sx={{ color: "#fff" }} onClick={startNewSession}>
            <AddCommentOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <IconButton size="small" sx={{ color: "#fff" }} onClick={onClose} aria-label="关闭聊天窗口">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      <Divider />

      {/* messages */}
      <Box
        ref={scrollRef}
        sx={{
          flexGrow: 1,
          overflowY: "auto",
          p: 1.6,
          bgcolor: "background.default",
          scrollBehavior: "smooth",
        }}
      >
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress size={26} />
          </Box>
        ) : messages.length === 0 ? (
          <Box sx={{ textAlign: "center", py: 6, color: "text.secondary" }}>
            <SmartToyOutlinedIcon sx={{ fontSize: 40, color: "grey.300", mb: 1 }} />
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              开始一段新的对话
            </Typography>
            <Typography variant="caption">
              试试问我：「2018 年延误最严重的航司有哪些？」
            </Typography>
          </Box>
        ) : (
          messages.map((message) => (
            <MessageRenderer key={message.id} message={message} onConfirm={confirmAction} />
          ))
        )}
      </Box>

      {error && (
        <Typography variant="caption" color="error" sx={{ px: 1.6, py: 0.6 }}>
          {error}
        </Typography>
      )}

      <ChatInput
        sending={sending}
        onSend={(text, attachments) => {
          void sendMessage(text, attachments);
        }}
      />
    </Paper>
  );
}
