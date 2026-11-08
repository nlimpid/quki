import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";

import { Navigate } from "react-router";

import { BacktestRoute, LayoutRoute, OverviewRoute, RootRedirect } from "./App.js";
import { PortfolioPage } from "./pages/PortfolioPage.js";
import { RotationPage } from "./pages/RotationPage.js";
import { StockPage } from "./pages/StockPage.js";
import { StocksPage } from "./pages/StocksPage.js";
import { ThemeProvider } from "./lib/theme.js";
import "./styles.css";
import "./dividends.css";

const router = createBrowserRouter([
  { path: "/", element: <RootRedirect /> },
  {
    path: "/index/:code",
    element: <LayoutRoute />,
    children: [
      { index: true, element: <OverviewRoute /> },
      { path: "backtest", element: <BacktestRoute /> },
    ],
  },
  { path: "/rotation", element: <RotationPage /> },
  { path: "/rotation/:pairId", element: <RotationPage /> },
  { path: "/stocks", element: <StocksPage /> },
  { path: "/stock/:code", element: <StockPage /> },
  { path: "/portfolio", element: <PortfolioPage /> },
  { path: "/me", element: <Navigate to="/portfolio" replace /> },
  { path: "*", element: <RootRedirect /> },
]);

const root = document.getElementById("root");
if (!root) throw new Error("missing root");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </StrictMode>,
);
