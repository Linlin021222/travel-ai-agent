"use client";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  TextField,
  Typography,
} from "@mui/material";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { apiRequest, ApiError } from "@/lib/api";
import { getToken, persistSession, type AuthUser } from "@/lib/auth";

type Mode = "login" | "signup";

interface AuthResponse {
  accessToken: string;
  user: AuthUser;
  message?: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (getToken()) router.replace("/dashboard");
  }, [router]);

  const validate = () => {
    const trimmed = email.trim();
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
    const nextEmailError = !trimmed
      ? "请输入电子邮箱"
      : /[^\x21-\x7e@]/.test(trimmed) || !validEmail
        ? "请输入有效的电子邮箱格式"
        : "";
    const nextPasswordError = !password
      ? "请输入密码"
      : password.length < 8
        ? "密码至少需要 8 个字符"
        : "";
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    return !nextEmailError && !nextPasswordError;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    setError("");
    if (!validate()) return;

    setLoading(true);
    try {
      const body = await apiRequest<AuthResponse>(`/auth/${mode}`, {
        method: "POST",
        body: { email: email.trim(), password },
      });
      persistSession(body.accessToken, body.user);
      setMessage(mode === "signup" ? "注册成功，已自动登录" : "登录成功");
      router.replace("/dashboard");
    } catch (requestError) {
      const detail =
        requestError instanceof ApiError
          ? requestError.message
          : requestError instanceof Error
            ? "网络连接失败，请确认后端服务已启动"
            : "请求失败，请稍后重试";
      setError(detail);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      className="auth-page"
      sx={{ minHeight: "100vh", display: "flex", alignItems: "center" }}
    >
      <Container maxWidth="sm">
        <Card elevation={8} className="auth-card">
          <CardContent sx={{ p: { xs: 3, sm: 5 } }}>
            <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }} gutterBottom>
              Flight Agent
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>
              {mode === "login" ? "登录你的工作空间" : "创建你的工作空间账户"}
            </Typography>
            {message && (
              <Alert severity="success" sx={{ mb: 2 }}>
                {message}
              </Alert>
            )}
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}
            <Box component="form" onSubmit={submit} noValidate>
              <TextField
                fullWidth
                label="电子邮箱"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                error={Boolean(emailError)}
                helperText={emailError || "请输入常用邮箱"}
                margin="normal"
                autoComplete="email"
              />
              <TextField
                fullWidth
                label="密码"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                error={Boolean(passwordError)}
                helperText={passwordError || "至少 8 个字符"}
                margin="normal"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
              <Button
                fullWidth
                size="large"
                type="submit"
                variant="contained"
                disabled={loading}
                sx={{ mt: 2 }}
              >
                {loading ? "处理中…" : mode === "login" ? "登录" : "注册"}
              </Button>
            </Box>
            <Button
              fullWidth
              sx={{ mt: 2 }}
              onClick={() => {
                setMode(mode === "login" ? "signup" : "login");
                setError("");
                setMessage("");
                setEmailError("");
                setPasswordError("");
              }}
            >
              {mode === "login" ? "还没有账户？立即注册" : "已有账户？返回登录"}
            </Button>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}
