"use client";

import MainLayout from "@/components/MainLayout";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";

/**
 * Placeholder task-progress board for the agent runtime.
 * Data is static for now — it exists so the navigation entry and layout are in
 * place before task orchestration lands.
 */

type TaskStatus = "running" | "done" | "queued" | "failed";

interface AgentTask {
  id: string;
  name: string;
  agent: string;
  status: TaskStatus;
  progress: number;
  startedAt: string;
  duration: string;
}

const STATUS_META: Record<TaskStatus, { label: string; color: "primary" | "success" | "default" | "error" }> = {
  running: { label: "执行中", color: "primary" },
  done: { label: "已完成", color: "success" },
  queued: { label: "排队中", color: "default" },
  failed: { label: "失败", color: "error" },
};

const TASKS: AgentTask[] = [
  {
    id: "T-20260916-001",
    name: "2018 年航司延误归因分析",
    agent: "数据分析 Agent",
    status: "running",
    progress: 62,
    startedAt: "2026-09-16 22:41",
    duration: "00:04:12",
  },
  {
    id: "T-20260916-002",
    name: "机场延误率 Top50 报表生成",
    agent: "报表 Agent",
    status: "done",
    progress: 100,
    startedAt: "2026-09-16 22:35",
    duration: "00:02:38",
  },
  {
    id: "T-20260916-003",
    name: "延误成因占比图表导出",
    agent: "可视化 Agent",
    status: "done",
    progress: 100,
    startedAt: "2026-09-16 22:30",
    duration: "00:01:05",
  },
  {
    id: "T-20260916-004",
    name: "航班明细数据一致性校验",
    agent: "数据校验 Agent",
    status: "queued",
    progress: 0,
    startedAt: "—",
    duration: "—",
  },
  {
    id: "T-20260916-005",
    name: "月度延误趋势预测",
    agent: "预测 Agent",
    status: "failed",
    progress: 41,
    startedAt: "2026-09-16 21:58",
    duration: "00:06:47",
  },
];

export default function AgentTasksPage() {
  return (
    <MainLayout>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
        Agent 任务进度
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
        展示 Agent 编排产生的任务列表与执行状态（当前为示例数据）。
      </Typography>

      <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: "wrap", gap: 2 }}>
        {(
          [
            { label: "总任务", value: TASKS.length },
            { label: "执行中", value: TASKS.filter((t) => t.status === "running").length },
            { label: "已完成", value: TASKS.filter((t) => t.status === "done").length },
            { label: "失败", value: TASKS.filter((t) => t.status === "failed").length },
          ] as const
        ).map((item) => (
          <Paper key={item.label} variant="outlined" sx={{ px: 2.5, py: 1.5, minWidth: 120 }}>
            <Typography variant="caption" color="text.secondary">
              {item.label}
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {item.value}
            </Typography>
          </Paper>
        ))}
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: "grey.50" }}>
              <TableCell sx={{ fontWeight: 700 }}>任务 ID</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>任务名称</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>执行 Agent</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>状态</TableCell>
              <TableCell sx={{ fontWeight: 700, width: 180 }}>进度</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>开始时间</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>耗时</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {TASKS.map((task) => {
              const meta = STATUS_META[task.status];
              return (
                <TableRow key={task.id} hover>
                  <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>{task.id}</TableCell>
                  <TableCell>{task.name}</TableCell>
                  <TableCell>{task.agent}</TableCell>
                  <TableCell>
                    <Chip size="small" color={meta.color} variant="outlined" label={meta.label} />
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <LinearProgress
                        variant="determinate"
                        value={task.progress}
                        sx={{ flexGrow: 1, height: 6, borderRadius: 3 }}
                        color={
                          task.status === "failed"
                            ? "error"
                            : task.status === "done"
                              ? "success"
                              : "primary"
                        }
                      />
                      <Typography variant="caption" sx={{ minWidth: 32 }}>
                        {task.progress}%
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>{task.startedAt}</TableCell>
                  <TableCell>{task.duration}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </MainLayout>
  );
}
