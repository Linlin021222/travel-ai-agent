"use client";

import Box from "@mui/material/Box";
import Fade from "@mui/material/Fade";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import SendIcon from "@mui/icons-material/Send";
import { useEffect, useState } from "react";
import ChatWindow from "./ChatWindow";

/**
 * Global floating entry point.
 *
 * Collapsed it renders a slim "input box" pill in the bottom-right corner;
 * clicking it expands the full chat window above it.
 */
export default function ChatLauncher() {
  const [open, setOpen] = useState(false);

  // Esc closes the window.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <Box
      sx={{
        position: "fixed",
        right: 24,
        bottom: 24,
        zIndex: (theme) => theme.zIndex.drawer + 2,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 1.2,
      }}
    >
      <Fade in={open} unmountOnExit>
        <Box sx={{ transformOrigin: "bottom right" }}>
          <ChatWindow onClose={() => setOpen(false)} />
        </Box>
      </Fade>

      {!open && (
        <Paper
          elevation={6}
          data-testid="chat-launcher"
          role="button"
          aria-label="打开 AI 助手对话"
          onClick={() => setOpen(true)}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.2,
            px: 2,
            py: 1.3,
            borderRadius: 999,
            cursor: "pointer",
            minWidth: 260,
            border: "1px solid",
            borderColor: "divider",
            "&:hover": { bgcolor: "action.hover", boxShadow: 8 },
            transition: "box-shadow .2s, background-color .2s",
          }}
        >
          <AutoAwesomeIcon fontSize="small" color="primary" />
          <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1, userSelect: "none" }}>
            问问 AI 数据分析助手…
          </Typography>
          <SendIcon fontSize="small" color="primary" />
        </Paper>
      )}
    </Box>
  );
}
