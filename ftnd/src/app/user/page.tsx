"use client";

import MainLayout from "@/components/MainLayout";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";
import { getUser } from "@/lib/auth";

export default function UserPage() {
  const [user, setUser] = useState<{ id: string; email: string; createdAt: string } | null>(null);

  useEffect(() => {
    setUser(getUser());
  }, []);

  return (
    <MainLayout>
      <Paper sx={{ p: 4 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }} gutterBottom>
          User
        </Typography>
        {user ? (
          <Stack spacing={1} sx={{ mt: 2 }}>
            <Typography>用户 ID：{user.id}</Typography>
            <Typography>电子邮箱：{user.email}</Typography>
            <Typography>
              创建时间：{new Date(user.createdAt).toLocaleString("zh-CN")}
            </Typography>
          </Stack>
        ) : (
          <Typography color="text.secondary">暂未获取到用户信息。</Typography>
        )}
      </Paper>
    </MainLayout>
  );
}
