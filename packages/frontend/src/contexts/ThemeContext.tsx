import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import {
  type ThemePreference,
  type ResolvedTheme,
  getStoredTheme,
  getResolvedTheme,
  applyTheme,
  applyResolvedTheme,
} from "../lib/theme";

interface ThemeContextValue {
  /** User preference: light, dark, or system. */
  preference: ThemePreference;
  /** Resolved theme: actual light or dark. */
  resolved: ResolvedTheme;
  /** Set theme preference and persist. */
  setTheme: (preference: ThemePreference) => void;
  /** Force light mode (e.g. Sketch phase). When true, data-theme is "light" regardless of preference. */
  setForceLightMode: (force: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

/** Resolved light/dark for components that may render outside ThemeProvider (e.g. unit tests); defaults to light. */
export function useOptionalResolvedTheme(): ResolvedTheme {
  return useContext(ThemeContext)?.resolved ?? "light";
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [preference, setPreference] = useState<ThemePreference>("system");
  const [resolved, setResolved] = useState<ResolvedTheme>("light");
  const [forceLightMode, setForceLightMode] = useState(false);

  const setTheme = useCallback((next: ThemePreference) => {
    applyTheme(next);
    setPreference(next);
    setResolved(getResolvedTheme());
  }, []);

  useEffect(() => {
    const pref = getStoredTheme();
    const res = getResolvedTheme();
    setPreference(pref);
    setResolved(res);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (pref === "system") {
        const newRes = media.matches ? "dark" : "light";
        setResolved(newRes);
      }
    };
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    const effective = forceLightMode ? "light" : resolved;
    applyResolvedTheme(effective);
  }, [forceLightMode, resolved]);

  const value: ThemeContextValue = {
    preference,
    resolved,
    setTheme,
    setForceLightMode,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
