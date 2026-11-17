import { ClerkProvider, useAuth as useClerkAuth } from "@clerk/react";
import { StrictMode, Suspense, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";

import { Navigate, Outlet, useNavigate } from "react-router";

import { BacktestRoute, LayoutRoute, OverviewRoute, RootRedirect } from "./App.js";
import { AuthProvider } from "./lib/auth.js";
import { PortfolioPage } from "./pages/PortfolioPage.js";
import { RotationPage } from "./pages/RotationPage.js";
import { StockPage } from "./pages/StockPage.js";
import { StocksPage } from "./pages/StocksPage.js";
import { ThemeProvider } from "./lib/theme.js";
import { LoginPage } from "./pages/LoginPage.js";

import "./styles.css";
import "./dividends.css";
import "./auth.css";

function sameOriginPath(to: string): string {
  try {
    const url = new URL(to, window.location.origin);
    if (url.origin !== window.location.origin) return "/";
    return `${url.pathname}${url.search}`;
  } catch {
    return "/";
  }
}

function ClerkBoundAuth({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, getToken, userId, signOut } = useClerkAuth();
  const userRef = useRef(userId);
  useEffect(() => {
    userRef.current = userId;
  }, [userId]);
  return (
    <AuthProvider
      sessionKey={isLoaded ? `ready:${userId ?? "guest"}` : "loading"}
      getAccessToken={async () => {
        if (!isLoaded || !isSignedIn) return null;
        const expected = userRef.current;
        const token = await getToken();
        if (userRef.current !== expected) return null;
        return typeof token === "string" && token.length > 0 ? token : null;
      }}
      onLogout={() => signOut()}
    >
      {children}
    </AuthProvider>
  );
}

function RootLayout() {
  const navigate = useNavigate();
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  const outlet = (
    <Suspense fallback={null}>
      <Outlet />
    </Suspense>
  );
  if (!publishableKey) return <AuthProvider>{outlet}</AuthProvider>;
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      routerPush={(to) => navigate(sameOriginPath(to))}
      routerReplace={(to) => navigate(sameOriginPath(to), { replace: true })}
      signInUrl="/login"
      signInFallbackRedirectUrl="/"
    >
      <ClerkBoundAuth>{outlet}</ClerkBoundAuth>
    </ClerkProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
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
      { path: "/login", element: <LoginPage /> },
      { path: "/login/*", element: <LoginPage /> },
      ...(import.meta.env.DEV
        ? [
            {
              path: "/preview/chart-fixtures",
              lazy: () =>
                import("./pages/ChartFixturePage.js").then((mod) => ({
                  Component: mod.ChartFixturePage,
                })),
            },
          ]
        : []),
      { path: "*", element: <RootRedirect /> },
    ],
  },
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
