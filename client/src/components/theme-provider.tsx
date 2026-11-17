import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type Theme = "dark" | "light" | "system";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  resolvedTheme: Exclude<Theme, "system">;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const initialState: ThemeProviderState = {
  theme: "system",
  resolvedTheme: "light",
  setTheme: () => null,
  toggleTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "invtrack-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeValue] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      const storedTheme = localStorage.getItem(storageKey);
      return storedTheme ? (storedTheme as Theme) : defaultTheme;
    }
    return defaultTheme;
  });

  const resolveTheme = useCallback((): "light" | "dark" =>
    theme === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : theme, [theme]);
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() =>
    typeof window === "undefined" ? "light" : resolveTheme());

  useEffect(() => {
    const root = window.document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const next = resolveTheme();
      root.classList.remove("light", "dark");
      root.classList.add(next);
      setResolvedTheme(next);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [resolveTheme]);

  const updateTheme = useCallback((nextTheme: Theme) => {
    localStorage.setItem(storageKey, nextTheme);
    setThemeValue(nextTheme);
  }, [storageKey]);

  const toggleTheme = useCallback(() => {
    updateTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, updateTheme]);

  const value = useMemo(() => ({
    theme,
    resolvedTheme,
    setTheme: updateTheme,
    toggleTheme,
  }), [resolvedTheme, theme, toggleTheme, updateTheme]);

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");

  return context;
};
