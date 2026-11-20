"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { Moon, Sun } from "lucide-react";

export type ThemeMode = "light" | "dark";

interface ThemeContextValue {
  theme: ThemeMode;
  isDark: boolean;
  mounted: boolean;
  setTheme: (next: ThemeMode) => void;
  toggleTheme: () => void;
}

const STORAGE_KEY = "voltgrid-theme";
const themeListeners = new Set<() => void>();

function readClientTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // ignore storage access restrictions
  }
  if (document.documentElement.classList.contains("dark")) return "dark";
  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function applyDomTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode;
}

function emitThemeChange() {
  for (const listener of themeListeners) listener();
}

function subscribeTheme(listener: () => void) {
  themeListeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      applyDomTheme(readClientTheme());
      listener();
    }
  };
  const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
  const onMedia = () => {
    try {
      if (!window.localStorage.getItem(STORAGE_KEY)) {
        applyDomTheme(readClientTheme());
        listener();
      }
    } catch {
      // ignore
    }
  };
  window.addEventListener("storage", onStorage);
  mql?.addEventListener?.("change", onMedia);
  return () => {
    themeListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    mql?.removeEventListener?.("change", onMedia);
  };
}

function subscribeMounted() {
  return () => {};
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  isDark: false,
  mounted: false,
  setTheme: () => {},
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore<ThemeMode>(
    subscribeTheme,
    readClientTheme,
    () => "light"
  );
  const mounted = useSyncExternalStore<boolean>(
    subscribeMounted,
    () => true,
    () => false
  );

  useEffect(() => {
    applyDomTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: ThemeMode) => {
    applyDomTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore storage quota errors
    }
    emitThemeChange();
  }, []);

  const toggleTheme = useCallback(() => {
    const next: ThemeMode = readClientTheme() === "dark" ? "light" : "dark";
    setTheme(next);
  }, [setTheme]);

  const value = useMemo(
    () => ({
      theme,
      isDark: mounted && theme === "dark",
      mounted,
      setTheme,
      toggleTheme,
    }),
    [theme, mounted, setTheme, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

/**
 * Provides unified Light/Dark color tokens for Recharts axes, grids, tooltips, and legends.
 */
export function useChartTheme() {
  const { isDark } = useTheme();
  return useMemo(
    () => ({
      isDark,
      gridStroke: isDark ? "#1e293b" : "#f1f5f9",
      scatterGridStroke: isDark ? "#1e293b" : "#e2e8f0",
      axisStroke: isDark ? "#334155" : "#e2e8f0",
      tickFill: isDark ? "#94a3b8" : "#64748b",
      categoryTickFill: isDark ? "#cbd5e1" : "#334155",
      cursorFill: isDark ? "rgba(30, 41, 59, 0.55)" : "#f8fafc",
      refLineStroke: isDark ? "#64748b" : "#94a3b8",
      tooltipStyle: {
        borderRadius: 10,
        backgroundColor: isDark ? "#0f172a" : "#ffffff",
        border: isDark ? "1px solid #334155" : "1px solid #e2e8f0",
        color: isDark ? "#f1f5f9" : "#0f172a",
        boxShadow: isDark
          ? "0 12px 28px -6px rgba(0, 0, 0, 0.55)"
          : "0 10px 22px -5px rgba(15, 23, 42, 0.1)",
        fontSize: 12,
      } as React.CSSProperties,
      tooltipLabelStyle: {
        color: isDark ? "#f1f5f9" : "#0f172a",
        fontWeight: 600,
        marginBottom: 2,
      } as React.CSSProperties,
      tooltipItemStyle: {
        color: isDark ? "#cbd5e1" : "#334155",
      } as React.CSSProperties,
      legendStyle: {
        fontSize: 12,
        color: isDark ? "#cbd5e1" : "#475569",
      } as React.CSSProperties,
    }),
    [isDark]
  );
}

export function ThemeToggleButton({ showLabel = true }: { showLabel?: boolean }) {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 text-xs font-medium shadow-2xs transition-colors cursor-pointer"
    >
      {isDark ? (
        <>
          <Sun className="w-3.5 h-3.5 text-amber-400" />
          {showLabel && <span className="hidden sm:inline">Light</span>}
        </>
      ) : (
        <>
          <Moon className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
          {showLabel && <span className="hidden sm:inline">Dark</span>}
        </>
      )}
    </button>
  );
}
