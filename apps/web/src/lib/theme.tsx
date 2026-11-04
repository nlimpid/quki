import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemeName = "light" | "dark";

const KEY = "quki-theme";

type ThemeContextValue = {
  theme: ThemeName;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function initialTheme(): ThemeName {
  const current = document.documentElement.dataset.theme;
  if (current === "light" || current === "dark") return current;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(KEY, theme);
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      toggle: () => setTheme((current) => (current === "dark" ? "light" : "dark")),
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme outside ThemeProvider");
  return value;
}
