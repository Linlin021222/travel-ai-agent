"use client";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import CloseIcon from "@mui/icons-material/Close";
import SendIcon from "@mui/icons-material/Send";
import { useRef, useState } from "react";
import type { ChatAttachment } from "@/lib/ai-agent";

interface ChatInputProps {
  disabled?: boolean;
  sending?: boolean;
  onSend: (text: string, attachments: ChatAttachment[]) => void;
}

export default function ChatInput({ disabled, sending, onSend }: ChatInputProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canSend = !disabled && !sending && (text.trim().length > 0 || attachments.length > 0);

  function submit() {
    if (!canSend) return;
    onSend(text.trim(), attachments);
    // Clear immediately after sending.
    setText("");
    setAttachments([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Enter sends, Shift+Enter inserts a newline.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const picked = Array.from(files).slice(0, 5).map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
    }));
    setAttachments((prev) => [...prev, ...picked].slice(0, 5));
  }

  return (
    <Box sx={{ borderTop: "1px solid", borderColor: "divider", p: 1.2, bgcolor: "background.paper" }}>
      {!!attachments.length && (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.6, mb: 1 }}>
          {attachments.map((file, index) => (
            <Chip
              key={`${file.name}-${index}`}
              size="small"
              icon={<AttachFileIcon />}
              label={file.name}
              onDelete={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
              deleteIcon={<CloseIcon />}
            />
          ))}
        </Box>
      )}

      <Box sx={{ display: "flex", alignItems: "flex-end", gap: 1 }}>
        <Tooltip title="上传文件（本周仅透传展示）">
          <IconButton
            size="small"
            disabled={disabled || sending}
            onClick={() => fileInputRef.current?.click()}
          >
            <AttachFileIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => handleFiles(event.target.files)}
        />

        <TextField
          fullWidth
          multiline
          maxRows={5}
          size="small"
          value={text}
          disabled={disabled || sending}
          placeholder="输入消息，Enter 发送，Shift + Enter 换行"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          slotProps={{ htmlInput: { "data-testid": "chat-input" } as never }}
          sx={{
            "& .MuiInputBase-root": { alignItems: "flex-end", fontSize: 14 },
          }}
        />

        <IconButton
          color="primary"
          disabled={!canSend}
          onClick={submit}
          sx={{ bgcolor: "primary.50", "&:hover": { bgcolor: "primary.100" } }}
        >
          {sending ? <CircularProgress size={18} /> : <SendIcon fontSize="small" />}
        </IconButton>
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.6, display: "block" }}>
        Enter 发送 · Shift + Enter 换行
      </Typography>
    </Box>
  );
}
