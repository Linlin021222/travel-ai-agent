"use client";

import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { getToken } from "@/lib/auth";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace(getToken() ? "/dashboard" : "/login");
  }, [router]);

  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <CircularProgress />
    </Box>
  );
}
