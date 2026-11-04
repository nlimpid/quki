import { Navigate, Outlet, useOutletContext, useParams } from "react-router";

import { BacktestPage } from "./pages/BacktestPage.js";
import { IndexLayout, type LayoutContext } from "./pages/IndexLayout.js";
import { OverviewPage } from "./pages/OverviewPage.js";

export function RootRedirect() {
  return <Navigate to="/index/H30269?period=W&range=5Y&vol=0" replace />;
}

export function LayoutRoute() {
  return <IndexLayout />;
}

export function OverviewRoute() {
  const { onOverview } = useOutletContext<LayoutContext>();
  const { code } = useParams();
  return <OverviewPage key={code} onOverview={onOverview} />;
}

export function BacktestRoute() {
  return <BacktestPage />;
}

export function Shell() {
  return <Outlet />;
}
