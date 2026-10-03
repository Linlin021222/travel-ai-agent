import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#1d4ed8" },
    secondary: { main: "#0f766e" },
    background: { default: "#f5f7fb", paper: "#ffffff" },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Microsoft YaHei", sans-serif',
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiTableCell: {
      styleOverrides: {
        head: {
          backgroundColor: "#eef2f7",
          fontWeight: 700,
          whiteSpace: "nowrap",
        },
      },
    },
  },
});
