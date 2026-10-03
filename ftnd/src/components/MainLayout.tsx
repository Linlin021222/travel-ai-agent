"use client";

import LogoutIcon from "@mui/icons-material/Logout";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearSession, getToken } from "@/lib/auth";
import ChatLauncher from "@/components/ai-agent/ChatLauncher";

export const NAV_ITEMS = [
  { label: "Dashboard", path: "/dashboard" },
  { label: "Flight info", path: "/flight-info" },
  { label: "Agent tasks", path: "/agent-tasks" },
  { label: "User", path: "/user" },
];

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [router]);

  const activeIndex = Math.max(
    0,
    NAV_ITEMS.findIndex((item) => pathname.startsWith(item.path)),
  );

  if (!ready) return null;

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="sticky" color="inherit" elevation={1}>
        <Toolbar sx={{ gap: 3 }}>
          <Typography variant="h6" color="primary" sx={{ fontWeight: 700 }}>
            Flight Agent
          </Typography>
          <Tabs
            value={activeIndex}
            onChange={(_, value: number) => router.push(NAV_ITEMS[value].path)}
            textColor="primary"
            indicatorColor="primary"
            sx={{ mr: "auto" }}
          >
            {NAV_ITEMS.map((item) => (
              <Tab key={item.path} label={item.label} sx={{ minWidth: 120 }} />
            ))}
          </Tabs>
          <Button
            color="inherit"
            startIcon={<LogoutIcon />}
            onClick={() => {
              clearSession();
              router.replace("/login");
            }}
          >
            退出
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth={false} sx={{ py: 4, px: { xs: 2, md: 4 } }}>
        {children}
      </Container>

      {/* Global floating AI chat entry (available on every authenticated page). */}
      {ready && <ChatLauncher />}
    </Box>
  );
}
